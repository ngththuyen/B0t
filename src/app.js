import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pg from 'pg';
import fs from 'fs/promises';

dotenv.config();

// ==================== CẤU HÌNH MÔI TRƯỜNG & HẰNG SỐ ====================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RESULT_CHANNEL_ID = process.env.RESULT_CHANNEL_ID || null;
const COUNTDOWN_CHANNEL_ID = '1494586446672302095'; 
const TIMEZONE = 'Asia/Ho_Chi_Minh';

const VOICE_START_TIME = process.env.VOICE_START_TIME || '20:00';
const VOICE_END_TIME   = process.env.VOICE_END_TIME   || '01:30';
const RESET_TIME       = process.env.RESET_TIME       || VOICE_END_TIME;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Thiếu DISCORD_TOKEN, CLIENT_ID hoặc GUILD_ID trong Variables');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });

const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ]
});

let activePeriod = false;
let currentDayKey = null;
const voiceStartTimes = new Map();

// ====================== HELPER CƠ BẢN ======================
function debugLog(section, msg) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE });
  console.log(`[${now}] [${section}] ${msg}`);
}

function parseTimeToCron(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

// Hàm đọc và ghi file JSON cho Daily Quiz
async function loadJSON(filename) {
  try {
    const data = await fs.readFile(filename, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return[];
  }
}

async function saveJSON(filename, data) {
  await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf-8');
}

// ====================== DATABASE & THỐNG KÊ ======================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_progress (
      day_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (day_key, user_id)
    );
  `);
  debugLog('DB', 'Kết nối Database thành công.');
}

async function addVoiceTime(userId, seconds) {
  if (!currentDayKey || seconds <= 0) return;
  try {
    await pool.query(`
      INSERT INTO voice_progress (day_key, user_id, total_seconds)
      VALUES ($1, $2, $3)
      ON CONFLICT (day_key, user_id)
      DO UPDATE SET total_seconds = voice_progress.total_seconds + EXCLUDED.total_seconds
    `,[currentDayKey, userId, seconds]);
  } catch (err) {
    debugLog('DB_ERR', `Lỗi lưu time user ${userId}: ${err.message}`);
  }
}

async function buildLeaderboardEmbed(dayKey) {
  const data = await pool.query(
    'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',[dayKey]
  );

  const embed = new EmbedBuilder().setColor(0x2b2d31).setTimestamp();

  if (data.rows.length === 0) {
    embed.setDescription(`## 📊 THỐNG KÊ THỜI GIAN HỌC\n*Ngày ${dayKey}*\n\n*Chưa có dữ liệu ghi nhận trong ca này.*`);
    return embed;
  }

  let desc = `## 📊 THỐNG KÊ THỜI GIAN HỌC\n*Ngày: ${dayKey}*\n\n`;
  
  await Promise.all(data.rows.map(async (row) => {
    try {
      const user = await client.users.fetch(row.user_id);
      row.username = user.username;
    } catch {
      row.username = row.user_id;
    }
  }));

  data.rows.forEach((row, index) => {
    const hours = String(Math.floor(row.total_seconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((row.total_seconds % 3600) / 60)).padStart(2, '0');
    const totalMin = Math.floor(row.total_seconds / 60);
    const status = totalMin >= 150 ? 'Đạt' : 'Chưa đạt';
    const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
    desc += `${rank} **${row.username}**\n└ ⏱️ ${hours}h ${mins}m — *${status}*\n\n`;
  });

  embed.setDescription(desc.trim());
  return embed;
}

// ====================== DAILY QUIZ SYSTEM ======================
async function sendDailyQuiz(channelId = COUNTDOWN_CHANNEL_ID) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) return debugLog('QUIZ', 'Không tìm thấy kênh Quiz.');

  const questions = await loadJSON('questions.json');
  if (questions.length === 0) {
    debugLog('QUIZ', 'Ngân hàng câu hỏi đã hết!');
    return;
  }

  // Bốc câu đầu tiên và xóa khỏi mảng
  const q = questions.shift(); 
  await saveJSON('questions.json', questions); // Lưu lại mảng đã xóa

  // Đưa câu hỏi vừa bốc vào lịch sử để kiểm tra đáp án sau này
  const history = await loadJSON('history_quizzes.json');
  history.push(q);
  await saveJSON('history_quizzes.json', history);

  const embed = new EmbedBuilder()
    .setTitle(`📝 DAILY QUIZ: MÔN ${q.subject.toUpperCase()}`)
    .setColor(0xffcc00)
    .setDescription(`**${q.question}**\n\n**A.** ${q.options.A}\n**B.** ${q.options.B}\n**C.** ${q.options.C}\n**D.** ${q.options.D}`)
    .setFooter({ text: 'Hãy chọn đáp án bên dưới nhé. Kết quả chỉ hiển thị với riêng bạn!' });

  if (q.image_url) {
    embed.setImage(q.image_url);
  }

  // Tạo hàng nút bấm ABCD
  const row = new ActionRowBuilder().addComponents(
    ['A', 'B', 'C', 'D'].map(opt => 
      new ButtonBuilder()
        .setCustomId(`quiz_${q.id}_${opt}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await channel.send({ embeds: [embed], components: [row] });
  debugLog('QUIZ', `Đã gửi câu hỏi ${q.id} lên kênh.`);
}


// ====================== XỬ LÝ THỜI GIAN & TRACKING ======================
function getTrackingState() {
  const now = new Date();
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const currentMins = localNow.getHours() * 60 + localNow.getMinutes();

  const[sH, sM] = VOICE_START_TIME.split(':').map(Number);
  const[eH, eM] = VOICE_END_TIME.split(':').map(Number);
  const startMins = sH * 60 + sM;
  const endMins = eH * 60 + eM;

  let isActive = false;
  let dayOffset = 0;

  if (startMins < endMins) {
    isActive = currentMins >= startMins && currentMins < endMins;
  } else {
    if (currentMins >= startMins) isActive = true;
    else if (currentMins < endMins) { isActive = true; dayOffset = -1; }
  }

  const targetDate = new Date(localNow);
  targetDate.setDate(targetDate.getDate() + dayOffset);
  const dayKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

  return { isActive, dayKey };
}

async function startTrackingSession(dayKeyStr) {
  currentDayKey = dayKeyStr;
  activePeriod = true;
  voiceStartTimes.clear();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    guild.members.cache.forEach(member => {
      if (member.voice?.channelId) voiceStartTimes.set(member.id, new Date());
    });
    debugLog('TRACKING', `Khởi động ca học: ${currentDayKey} | ${voiceStartTimes.size} user đang trực tuyến`);
  }
}

// ====================== CRON JOBS ======================
cron.schedule(parseTimeToCron(VOICE_START_TIME), async () => {
  const { dayKey } = getTrackingState();
  await startTrackingSession(dayKey);
}, { timezone: TIMEZONE });

cron.schedule(parseTimeToCron(VOICE_END_TIME), async () => {
  const promises =[];
  for (const[userId, startTime] of voiceStartTimes.entries()) {
    const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    promises.push(addVoiceTime(userId, seconds));
  }
  await Promise.all(promises);
  activePeriod = false;
  voiceStartTimes.clear();
  debugLog('TRACKING', 'Đã kết thúc ca học và chốt sổ dữ liệu.');
}, { timezone: TIMEZONE });

cron.schedule(parseTimeToCron(RESET_TIME), async () => {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;
  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (channel) {
    const embed = await buildLeaderboardEmbed(currentDayKey);
    await channel.send({ embeds: [embed] });
  }
}, { timezone: TIMEZONE });

cron.schedule('*/5 * * * *', async () => {
  if (voiceStartTimes.size === 0 || !activePeriod) return;
  for (const [userId, startTime] of[...voiceStartTimes.entries()]) {
    const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    if (elapsedSeconds >= 60) {
      await addVoiceTime(userId, elapsedSeconds);
      voiceStartTimes.set(userId, new Date()); 
    }
  }
}, { timezone: TIMEZONE });

// Cron chạy Daily Quiz vào 5 khung giờ mỗi ngày: 6h, 10h, 14h, 18h, 21h
cron.schedule('0 6,10,14,18,21 * * *', async () => {
  debugLog('CRON', 'Tới giờ gửi Daily Quiz!');
  await sendDailyQuiz();
}, { timezone: TIMEZONE });

// ====================== SỰ KIỆN BOT ======================
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!activePeriod || !newState.member || newState.guild.id !== GUILD_ID) return;
  const userId = newState.member.id;
  const wasInVoice = !!oldState.channelId;
  const isInVoice  = !!newState.channelId;

  if (!wasInVoice && isInVoice) {
    voiceStartTimes.set(userId, new Date()); 
  } else if (wasInVoice && !isInVoice) {
    if (voiceStartTimes.has(userId)) {
      const start = voiceStartTimes.get(userId);
      const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
      await addVoiceTime(userId, seconds);
      voiceStartTimes.delete(userId);
    }
  }
});

client.on('interactionCreate', async interaction => {
  // 1. Xử lý khi nhấn nút Đáp Án Quiz
  if (interaction.isButton() && interaction.customId.startsWith('quiz_')) {
    // Tách Custom ID: VD "quiz_VN_10_B" => qId = "VN_10", chosen = "B"
    const parts = interaction.customId.split('_');
    const chosen = parts.pop(); // Lấy chữ cái cuối cùng (A, B, C, D)
    const qId = parts.slice(1).join('_'); // Lấy mã câu hỏi

    const history = await loadJSON('history_quizzes.json');
    const q = history.find(x => x.id === qId);

    if (!q) {
      return interaction.reply({ content: '❌ Rất tiếc, câu hỏi này đã hết hạn hoặc bị lỗi dữ liệu!', ephemeral: true });
    }

    const isCorrect = chosen === q.correct;
    
    const replyEmbed = new EmbedBuilder()
      .setTitle(isCorrect ? '✅ CHÍNH XÁC! TUYỆT VỜI!' : '❌ RẤT TIẾC, SAI RỒI!')
      .setColor(isCorrect ? 0x00ff88 : 0xff3333)
      .setDescription(`Bạn đã chọn **${chosen}**. Đáp án đúng là: **${q.correct}**.\n\n### 📖 Giải thích:\n${q.explanation}`);

    // Tham số ephemeral: true sẽ giúp tin nhắn chỉ hiển thị riêng tư cho người vừa nhấn nút
    await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
    return;
  }

  // 2. Xử lý Slash Commands
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'check') {
    try {
      const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
      const targetDayKey = currentDayKey || res.rows[0]?.day_key;
      if (!targetDayKey) return interaction.reply({ content: '📭 Chưa có dữ liệu ghi nhận.', ephemeral: true });
      const embed = await buildLeaderboardEmbed(targetDayKey);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      await interaction.reply({ content: '❌ Lỗi hệ thống, vui lòng thử lại sau.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'debug') {
    // Chuyển /debug thành lệnh test Quiz
    await interaction.reply({ content: '⏳ Đang khởi tạo Daily Quiz...', ephemeral: true });
    await sendDailyQuiz(interaction.channelId); // Gửi thẳng vào kênh vừa gõ lệnh để Admin test
  }
});

client.once('ready', async () => {
  console.log('='.repeat(50));
  debugLog('READY', `Bot ${client.user.tag} đã online!`);
  
  await initDB();

  const commands =[
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Xem thống kê thời gian học của ca hiện tại'),
    new SlashCommandBuilder()
      .setName('debug')
      .setDescription('[Admin] Test giao diện Daily Quiz')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    debugLog('READY', 'Đã đăng ký lệnh (/check, /debug)');
  } catch (error) {
    debugLog('ERR', 'Lỗi đăng ký lệnh: ' + error.message);
  }

  const { isActive, dayKey } = getTrackingState();
  if (isActive) {
    await startTrackingSession(dayKey);
  }
  console.log('='.repeat(50));
});

process.on('unhandledRejection', (reason) => {
  debugLog('CRITICAL_ERR', `Unhandled Rejection: ${reason}`);
});

client.login(TOKEN);