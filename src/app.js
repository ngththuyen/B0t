import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes, PermissionFlagsBits } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pg from 'pg';

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

// Data các kỳ thi quan trọng
const EXAMS =[
  { name: 'Kỳ thi Đánh giá Năng Lực (VACT) - Đợt 2', date: new Date('2026-05-24T08:30:00+07:00') },
  { name: 'Kỳ thi Tốt nghiệp THPT Quốc Gia 2026', date: new Date('2026-06-11T07:30:00+07:00') }
];

// Trích dẫn truyền cảm hứng
const MOTIVATIONAL_QUOTES =[
  "\"Thiên tài 1% là cảm hứng và 99% là mồ hôi.\" — Thomas Edison",
  "\"Kẻ duy nhất bạn nên cố gắng để giỏi hơn, chính là bạn của ngày hôm qua.\" — Sigmund Freud",
  "\"Không có giới hạn nào cho những gì chúng ta có thể đạt được, ngoại trừ giới hạn do chính chúng ta tạo ra.\" — Khuyết danh",
  "\"Giáo dục là vũ khí mạnh nhất mà bạn có thể dùng để thay đổi thế giới.\" — Nelson Mandela",
  "\"Tương lai thuộc về những người tin vào vẻ đẹp trong những giấc mơ của họ.\" — Eleanor Roosevelt",
  "\"Nơi nào có ý chí, nơi đó có con đường.\" — Pauline Kael",
  "\"Sự nỗ lực trọn vẹn là chiến thắng trọn vẹn.\" — Mahatma Gandhi",
  "\"Thành công không phải là đích đến, đó là một hành trình.\" — Arthur Ashe",
  "\"Đừng sợ thất bại, mà hãy sợ việc không dám thử.\" – Roy T. Bennett",
  "\"Without hard work, nothing grows but weeds.\" – Gordon B. Hinckley",
  "\"If your dreams do not scare you, they are not big enough.\" – Ellen Johnson Sirleaf",
  "\"Sự hài lòng không nằm ở kết quả đạt được, mà ở chính nỗ lực mà chúng ta bỏ ra.\" – Mahatma Gandhi",
  "\"If we don’t plant knowledge when young, it will give us no shade when we’re old.\" – Chesterfield",
  "\"Learning without reflection is a wasted effort.\"",
  "\"Continuous learning is essential because life continuously provides lessons.\"",
  "\"You can’t learn what you think you already know.\"",
  "\"Your willingness to learn determines your progress.\"",
  "\"Học tập là ngọn lửa duy nhất có thể cháy mãi mãi trong tâm hồn một con người.\" - Albert Einstein",
  "\"Công việc của học tập không phải là nhận biết cái gì đó mới, mà là làm cho chúng ta trở thành người mới.\" - John C. Maxwell",
  "\"Tri thức là sức mạnh. Học tập là cánh cửa mở ra thế giới mới.\" - Malcolm X",
  "\"Sự hiểu biết chưa bao giờ là một gánh nặng. Nó là chiếc chìa khóa mở cánh cửa cho sự tự do.\" - Harry S. Truman"
];

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
    `, [currentDayKey, userId, seconds]);
  } catch (err) {
    debugLog('DB_ERR', `Lỗi lưu time user ${userId}: ${err.message}`);
  }
}

// Xây dựng giao diện Embed Bảng Xếp Hạng
async function buildLeaderboardEmbed(dayKey) {
  const data = await pool.query(
    'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',
    [dayKey]
  );

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31) // Màu nền tối thanh lịch
    .setTimestamp();

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

// Xây dựng giao diện Embed Đếm Ngược (Dùng UNIX Timestamp của Discord)
function buildCountdownEmbed() {
  let desc = `## ⏳ ĐẾM NGƯỢC KỲ THI\n\n`;

  for (const exam of EXAMS) {
    // Chuyển đổi Date sang Unix Timestamp (giây)
    const unixTime = Math.floor(exam.date.getTime() / 1000);
    
    if (exam.date > new Date()) {
      // Dùng <t:time:F> để hiển thị thứ/ngày/tháng/giờ chính xác theo thiết bị user
      // Dùng <t:time:R> để đếm ngược trực tiếp (in 2 months, in 5 days...)
      desc += `### ${exam.name}\n└ ⏰ **Thời gian:** <t:${unixTime}:F>\n└ ⏳ **Còn lại:** <t:${unixTime}:R>\n\n`;
    } else {
      desc += `### ${exam.name}\n└ *Kỳ thi đã diễn ra vào <t:${unixTime}:D>!*\n\n`;
    }
  }

  const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];

  return new EmbedBuilder()
    .setColor(0x5865f2) 
    .setDescription(desc.trim())
    .setFooter({ text: quote });
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
// 1. Cron bắt đầu tính giờ học
cron.schedule(parseTimeToCron(VOICE_START_TIME), async () => {
  const { dayKey } = getTrackingState();
  await startTrackingSession(dayKey);
}, { timezone: TIMEZONE });

// 2. Cron kết thúc giờ học
cron.schedule(parseTimeToCron(VOICE_END_TIME), async () => {
  const promises = [];
  for (const[userId, startTime] of voiceStartTimes.entries()) {
    const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    promises.push(addVoiceTime(userId, seconds));
  }
  await Promise.all(promises);
  activePeriod = false;
  voiceStartTimes.clear();
  debugLog('TRACKING', 'Đã kết thúc ca học và chốt sổ dữ liệu.');
}, { timezone: TIMEZONE });

// 3. Cron gửi tổng kết (RESET_TIME)
cron.schedule(parseTimeToCron(RESET_TIME), async () => {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;
  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (channel) {
    const embed = await buildLeaderboardEmbed(currentDayKey);
    await channel.send({ embeds: [embed] });
    debugLog('RESULT', `Đã gửi bảng thành tích ngày ${currentDayKey}`);
  }
}, { timezone: TIMEZONE });

// 4. Cron Auto-Save (Mỗi 5 phút)
cron.schedule('*/5 * * * *', async () => {
  if (voiceStartTimes.size === 0 || !activePeriod) return;
  
  let savedCount = 0;
  for (const [userId, startTime] of[...voiceStartTimes.entries()]) {
    const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    if (elapsedSeconds >= 60) {
      await addVoiceTime(userId, elapsedSeconds);
      voiceStartTimes.set(userId, new Date()); 
      savedCount++;
    }
  }
  if (savedCount > 0) debugLog('AUTO-SAVE', `Đã đồng bộ thời gian cho ${savedCount} users.`);
}, { timezone: TIMEZONE });

// 5. Cron gửi Countdown Kỳ thi (00:00 mỗi ngày)
cron.schedule('0 0 * * *', async () => {
  const channel = client.channels.cache.get(COUNTDOWN_CHANNEL_ID);
  if (channel) {
    await channel.send({ embeds:[buildCountdownEmbed()] });
    debugLog('COUNTDOWN', 'Đã gửi thông báo đếm ngược lúc nửa đêm.');
  } else {
    debugLog('COUNTDOWN', 'Không tìm thấy kênh đếm ngược.');
  }
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
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'check') {
    try {
      const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
      const targetDayKey = currentDayKey || res.rows[0]?.day_key;

      if (!targetDayKey) {
        return interaction.reply({ content: '📭 Chưa có dữ liệu ghi nhận.', ephemeral: true });
      }

      const embed = await buildLeaderboardEmbed(targetDayKey);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      debugLog('CMD_ERR', `Lỗi lệnh /check: ${err.message}`);
      await interaction.reply({ content: '❌ Lỗi hệ thống, vui lòng thử lại sau.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'debug') {
    await interaction.reply({ embeds: [buildCountdownEmbed()] });
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
      .setDescription('[Admin] Kiểm tra giao diện bảng đếm ngược')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    debugLog('READY', 'Đã đăng ký hệ thống Slash Commands (/check, /debug)');
  } catch (error) {
    debugLog('ERR', 'Lỗi đăng ký lệnh: ' + error.message);
  }

  const { isActive, dayKey } = getTrackingState();
  if (isActive) {
    debugLog('RECOVER', `Khôi phục tiến trình tracking cho ngày ${dayKey}`);
    await startTrackingSession(dayKey);
  }
  
  console.log('='.repeat(50));
});

process.on('unhandledRejection', (reason) => {
  debugLog('CRITICAL_ERR', `Unhandled Rejection: ${reason}`);
});

client.login(TOKEN);