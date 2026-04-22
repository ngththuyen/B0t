import {
  Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder,
  REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle
} from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pg from 'pg';

dotenv.config();

// ==================== CẤU HÌNH MÔI TRƯỜNG & HẰNG SỐ ====================
const TOKEN             = process.env.DISCORD_TOKEN;
const CLIENT_ID         = process.env.CLIENT_ID;
const GUILD_ID          = process.env.GUILD_ID;
const RESULT_CHANNEL_ID = process.env.RESULT_CHANNEL_ID || null;
const COUNTDOWN_CHANNEL_ID = '1494586446672302095';
const TIMEZONE          = 'Asia/Ho_Chi_Minh';

const VOICE_START_TIME  = process.env.VOICE_START_TIME || '20:00';
const VOICE_END_TIME    = process.env.VOICE_END_TIME   || '01:30';
const RESET_TIME        = process.env.RESET_TIME       || VOICE_END_TIME;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Thiếu DISCORD_TOKEN, CLIENT_ID hoặc GUILD_ID trong Variables');
  process.exit(1);
}

// ==================== DATA CỐ ĐỊNH ====================
// Danh sách các kỳ thi quan trọng (chỉnh sửa tại đây)
const EXAMS = [
  { name: 'Kỳ thi Đánh giá Năng Lực (VACT) - Đợt 2', date: new Date('2026-05-24T08:30:00+07:00') },
  { name: 'Kỳ thi Tốt nghiệp THPT Quốc Gia 2026',    date: new Date('2026-06-11T07:30:00+07:00') }
];

const MOTIVATIONAL_QUOTES = [
  '"Thiên tài 1% là cảm hứng và 99% là mồ hôi." — Thomas Edison',
  '"Kẻ duy nhất bạn nên cố gắng để giỏi hơn, chính là bạn của ngày hôm qua." — Sigmund Freud',
  '"Giáo dục là vũ khí mạnh nhất mà bạn có thể dùng để thay đổi thế giới." — Nelson Mandela',
  '"Tương lai thuộc về những người tin vào vẻ đẹp trong những giấc mơ của họ." — Eleanor Roosevelt',
  '"Sự nỗ lực trọn vẹn là chiến thắng trọn vẹn." — Mahatma Gandhi',
  '"Đừng sợ thất bại, mà hãy sợ việc không dám thử." — Roy T. Bennett',
  '"Without hard work, nothing grows but weeds." — Gordon B. Hinckley',
  '"If your dreams do not scare you, they are not big enough." — Ellen Johnson Sirleaf',
  '"Học tập là ngọn lửa duy nhất có thể cháy mãi mãi trong tâm hồn một con người." — Albert Einstein',
  '"Tri thức là sức mạnh. Học tập là cánh cửa mở ra thế giới mới." — Malcolm X',
  '"Công việc của học tập không phải là nhận biết cái gì đó mới, mà là làm cho chúng ta trở thành người mới." — John C. Maxwell',
  '"You can\'t learn what you think you already know."',
  '"Continuous learning is essential because life continuously provides lessons."'
];

// ==================== KHỞI TẠO CLIENT & POOL ====================
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ]
});

let activePeriod = false;
let currentDayKey = null;
const voiceStartTimes = new Map();

// ====================== HELPER ======================
function debugLog(section, msg) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE });
  console.log(`[${now}] [${section}] ${msg}`);
}

function parseTimeToCron(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

// ====================== DATABASE ======================
async function initDB() {
  // Bảng theo dõi thời gian voice
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_progress (
      day_key       TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      total_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (day_key, user_id)
    );
  `);

  // Bảng ngân hàng câu hỏi quiz
  // sent_at: NULL = chưa dùng, có giá trị = đã gửi (để tra cứu khi nhấn nút)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id        TEXT PRIMARY KEY,
      subject   TEXT NOT NULL,
      question  TEXT NOT NULL,
      options   JSONB NOT NULL,
      correct   TEXT NOT NULL,
      image_url TEXT,
      sent_at   TIMESTAMPTZ DEFAULT NULL
    );
  `);

  debugLog('DB', 'Kết nối Database thành công. Các bảng đã sẵn sàng.');
}

// ====================== VOICE TRACKING ======================
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

async function buildLeaderboardEmbed(dayKey) {
  const data = await pool.query(
    'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',
    [dayKey]
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
    const hours    = String(Math.floor(row.total_seconds / 3600)).padStart(2, '0');
    const mins     = String(Math.floor((row.total_seconds % 3600) / 60)).padStart(2, '0');
    const totalMin = Math.floor(row.total_seconds / 60);
    const status   = totalMin >= 150 ? 'Đạt ✅' : 'Chưa đạt ❌';
    const rank     = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
    desc += `${rank} **${row.username}**\n└ ⏱️ ${hours}h ${mins}m — *${status}*\n\n`;
  });

  embed.setDescription(desc.trim());
  return embed;
}

// ====================== COUNTDOWN FEATURE ======================
function buildCountdownEmbed() {
  let desc = `## ⏳ Đếm Ngược Kỳ Thi\n\n`;
  const now = new Date();

  for (const exam of EXAMS) {
    const unixTime = Math.floor(exam.date.getTime() / 1000);
    const diffTime = exam.date - now;

    if (diffTime > 0) {
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      desc += `### ${exam.name}\n└ ⏰ **Thời gian:** <t:${unixTime}:F>\n└ ⏳ **Còn lại:** **${days} ngày** (<t:${unixTime}:R>)\n\n`;
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

// ====================== QUIZ FEATURE ======================

/**
 * Import danh sách câu hỏi từ mảng JSON vào database.
 * Bỏ qua câu nào có id đã tồn tại (ON CONFLICT DO NOTHING).
 * Trả về { inserted, skipped } count.
 */
async function importQuestionsFromJSON(questions) {
  let inserted = 0;
  let skipped  = 0;

  for (const q of questions) {
    // Validate tối thiểu
    if (!q.id || !q.subject || !q.question || !q.options || !q.correct) {
      skipped++;
      continue;
    }
    try {
      const result = await pool.query(`
        INSERT INTO quiz_questions (id, subject, question, options, correct, image_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [q.id, q.subject, q.question, JSON.stringify(q.options), q.correct, q.image_url || null]);

      if (result.rowCount > 0) inserted++;
      else skipped++;
    } catch (err) {
      debugLog('QUIZ_IMPORT_ERR', `Lỗi câu ${q.id}: ${err.message}`);
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * Gửi 1 câu quiz ngẫu nhiên (chưa dùng) lên kênh.
 * Sau khi gửi, đánh dấu sent_at = NOW() để tra cứu khi nhấn nút.
 */
async function sendDailyQuiz(channelId = COUNTDOWN_CHANNEL_ID) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) return debugLog('QUIZ', 'Không tìm thấy kênh Quiz.');

  // Lấy 1 câu hỏi chưa gửi, ngẫu nhiên
  const res = await pool.query(
    'SELECT * FROM quiz_questions WHERE sent_at IS NULL ORDER BY RANDOM() LIMIT 1'
  );

  if (res.rows.length === 0) {
    debugLog('QUIZ', '⚠️ Ngân hàng câu hỏi đã hết! Hãy dùng /addquestion để thêm câu mới.');
    await channel.send({ content: '⚠️ **Ngân hàng câu hỏi đã hết!** Admin vui lòng dùng `/addquestion` để bổ sung.' });
    return;
  }

  const q = res.rows[0];

  // Đánh dấu đã gửi
  await pool.query('UPDATE quiz_questions SET sent_at = NOW() WHERE id = $1', [q.id]);

  const embed = new EmbedBuilder()
    .setTitle(`📝 DAILY QUIZ — MÔN ${q.subject.toUpperCase()}`)
    .setColor(0xffcc00)
    .setDescription(
      `**${q.question}**\n\n` +
      `**A.** ${q.options.A}\n` +
      `**B.** ${q.options.B}\n` +
      `**C.** ${q.options.C}\n` +
      `**D.** ${q.options.D}`
    )
    .setFooter({ text: 'Chọn đáp án bên dưới — chỉ bạn thấy kết quả!' });

  if (q.image_url) embed.setImage(q.image_url);

  const row = new ActionRowBuilder().addComponents(
    ['A', 'B', 'C', 'D'].map(opt =>
      new ButtonBuilder()
        .setCustomId(`quiz_${q.id}_${opt}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await channel.send({ embeds: [embed], components: [row] });
  debugLog('QUIZ', `Đã gửi câu hỏi [${q.id}] lên kênh.`);
}

// ====================== XỬ LÝ THỜI GIAN & TRACKING ======================
function getTrackingState() {
  const now      = new Date();
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const currentMins = localNow.getHours() * 60 + localNow.getMinutes();

  const [sH, sM]  = VOICE_START_TIME.split(':').map(Number);
  const [eH, eM]  = VOICE_END_TIME.split(':').map(Number);
  const startMins = sH * 60 + sM;
  const endMins   = eH * 60 + eM;

  let isActive  = false;
  let dayOffset = 0;

  if (startMins < endMins) {
    isActive = currentMins >= startMins && currentMins < endMins;
  } else {
    if (currentMins >= startMins)       { isActive = true; }
    else if (currentMins < endMins)     { isActive = true; dayOffset = -1; }
  }

  const targetDate = new Date(localNow);
  targetDate.setDate(targetDate.getDate() + dayOffset);
  const dayKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

  return { isActive, dayKey };
}

async function startTrackingSession(dayKeyStr) {
  currentDayKey = dayKeyStr;
  activePeriod  = true;
  voiceStartTimes.clear();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    guild.members.cache.forEach(member => {
      if (member.voice?.channelId) voiceStartTimes.set(member.id, new Date());
    });
    debugLog('TRACKING', `Khởi động ca học: ${currentDayKey} | ${voiceStartTimes.size} user đang online`);
  }
}

// ====================== CRON JOBS ======================

// 1. Bắt đầu ca học
cron.schedule(parseTimeToCron(VOICE_START_TIME), async () => {
  const { dayKey } = getTrackingState();
  await startTrackingSession(dayKey);
}, { timezone: TIMEZONE });

// 2. Kết thúc ca học — chốt sổ tất cả user còn online
cron.schedule(parseTimeToCron(VOICE_END_TIME), async () => {
  const promises = [];
  for (const [userId, startTime] of voiceStartTimes.entries()) {
    const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    promises.push(addVoiceTime(userId, seconds));
  }
  await Promise.all(promises);
  activePeriod = false;
  voiceStartTimes.clear();
  debugLog('TRACKING', 'Đã kết thúc ca học và chốt sổ dữ liệu.');
}, { timezone: TIMEZONE });

// 3. Gửi bảng xếp hạng (RESET_TIME)
cron.schedule(parseTimeToCron(RESET_TIME), async () => {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;
  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (channel) {
    const embed = await buildLeaderboardEmbed(currentDayKey);
    await channel.send({ embeds: [embed] });
    debugLog('RESULT', `Đã gửi bảng thành tích ngày ${currentDayKey}`);
  }
}, { timezone: TIMEZONE });

// 4. Auto-Save mỗi 5 phút
cron.schedule('*/5 * * * *', async () => {
  if (voiceStartTimes.size === 0 || !activePeriod) return;
  let savedCount = 0;
  for (const [userId, startTime] of [...voiceStartTimes.entries()]) {
    const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    if (elapsedSeconds >= 60) {
      await addVoiceTime(userId, elapsedSeconds);
      voiceStartTimes.set(userId, new Date());
      savedCount++;
    }
  }
  if (savedCount > 0) debugLog('AUTO-SAVE', `Đã đồng bộ thời gian cho ${savedCount} users.`);
}, { timezone: TIMEZONE });

// 5. Countdown kỳ thi — gửi lúc 00:00 mỗi ngày
cron.schedule('0 0 * * *', async () => {
  const channel = client.channels.cache.get(COUNTDOWN_CHANNEL_ID);
  if (channel) {
    await channel.send({ embeds: [buildCountdownEmbed()] });
    debugLog('COUNTDOWN', 'Đã gửi thông báo đếm ngược lúc nửa đêm.');
  } else {
    debugLog('COUNTDOWN', 'Không tìm thấy kênh đếm ngược.');
  }
}, { timezone: TIMEZONE });

// 6. Daily Quiz — gửi 5 lần/ngày: 6h, 10h, 14h, 18h, 21h
cron.schedule('0 6,10,14,18,21 * * *', async () => {
  debugLog('CRON', 'Tới giờ gửi Daily Quiz!');
  await sendDailyQuiz();
}, { timezone: TIMEZONE });

// ====================== SỰ KIỆN VOICE ======================
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!activePeriod || !newState.member || newState.guild.id !== GUILD_ID) return;

  const userId     = newState.member.id;
  const wasInVoice = !!oldState.channelId;
  const isInVoice  = !!newState.channelId;

  if (!wasInVoice && isInVoice) {
    voiceStartTimes.set(userId, new Date());
  } else if (wasInVoice && !isInVoice) {
    if (voiceStartTimes.has(userId)) {
      const start   = voiceStartTimes.get(userId);
      const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
      await addVoiceTime(userId, seconds);
      voiceStartTimes.delete(userId);
    }
  }
});

// ====================== SỰ KIỆN INTERACTION ======================
client.on('interactionCreate', async interaction => {

  // ── Xử lý nút bấm quiz ──
  if (interaction.isButton() && interaction.customId.startsWith('quiz_')) {
    // customId dạng: quiz_{id}_{option}  — vd: quiz_VN_01_B
    const parts  = interaction.customId.split('_');
    const chosen = parts.pop();             // Ký tự cuối = đáp án người chọn
    const qId    = parts.slice(1).join('_'); // Phần giữa = ID câu hỏi

    const res = await pool.query('SELECT * FROM quiz_questions WHERE id = $1', [qId]);
    const q   = res.rows[0];

    if (!q) {
      return interaction.reply({ content: '❌ Câu hỏi này đã hết hạn hoặc bị lỗi dữ liệu!', ephemeral: true });
    }

    const isCorrect = chosen === q.correct;

    const replyEmbed = new EmbedBuilder()
      .setTitle(isCorrect ? '✅ CHÍNH XÁC! TUYỆT VỜI!' : '❌ RẤT TIẾC, SAI RỒI!')
      .setColor(isCorrect ? 0x00ff88 : 0xff3333)
      .setDescription(
        `Bạn đã chọn **${chosen}**.\n` +
        `Đáp án đúng là: **${q.correct}** — ${q.options[q.correct]}`
      );

    return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
  }

  // ── Slash Commands ──
  if (!interaction.isChatInputCommand()) return;

  // /check — xem bảng xếp hạng
  if (interaction.commandName === 'check') {
    try {
      const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
      const targetDayKey = currentDayKey || res.rows[0]?.day_key;
      if (!targetDayKey) return interaction.reply({ content: '📭 Chưa có dữ liệu ghi nhận.', ephemeral: true });
      const embed = await buildLeaderboardEmbed(targetDayKey);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      debugLog('CMD_ERR', `Lỗi /check: ${err.message}`);
      await interaction.reply({ content: '❌ Lỗi hệ thống, vui lòng thử lại sau.', ephemeral: true });
    }
  }

  // /debug — admin test giao diện countdown + quiz
  if (interaction.commandName === 'debug') {
    const mode = interaction.options.getString('mode') || 'countdown';
    if (mode === 'quiz') {
      await interaction.reply({ content: '⏳ Đang tải câu hỏi thử...', ephemeral: true });
      await sendDailyQuiz(interaction.channelId);
    } else {
      await interaction.reply({ embeds: [buildCountdownEmbed()] });
    }
  }

  // /addquestion — admin import file JSON câu hỏi
  if (interaction.commandName === 'addquestion') {
    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.json')) {
      return interaction.editReply('❌ Vui lòng đính kèm file `.json`!');
    }

    try {
      // Fetch nội dung file từ Discord CDN
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`Không tải được file: ${response.statusText}`);

      const text      = await response.text();
      const questions = JSON.parse(text);

      if (!Array.isArray(questions)) {
        return interaction.editReply('❌ File JSON phải là một **mảng** (array) các câu hỏi!');
      }

      const { inserted, skipped } = await importQuestionsFromJSON(questions);

      // Đếm tổng câu chưa dùng còn trong kho
      const countRes = await pool.query('SELECT COUNT(*) FROM quiz_questions WHERE sent_at IS NULL');
      const remaining = countRes.rows[0].count;

      const resultEmbed = new EmbedBuilder()
        .setTitle('📚 Kết quả Import Ngân Hàng Câu Hỏi')
        .setColor(0x00ff88)
        .setDescription(
          `✅ **Thêm mới thành công:** ${inserted} câu\n` +
          `⏭️ **Bỏ qua (trùng ID hoặc lỗi):** ${skipped} câu\n\n` +
          `📦 **Tổng câu chưa dùng trong kho:** ${remaining} câu`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed] });
      debugLog('QUIZ_IMPORT', `Admin ${interaction.user.username} đã import: +${inserted} câu, bỏ qua ${skipped} câu.`);

    } catch (err) {
      debugLog('QUIZ_IMPORT_ERR', err.message);
      await interaction.editReply(`❌ Lỗi khi đọc file: \`${err.message}\``);
    }
  }

  // /quizstats — xem thống kê ngân hàng câu hỏi
  if (interaction.commandName === 'quizstats') {
    try {
      const res = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE sent_at IS NULL)  AS remaining,
          COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS used,
          COUNT(*) AS total
        FROM quiz_questions
      `);
      const { remaining, used, total } = res.rows[0];

      const embed = new EmbedBuilder()
        .setTitle('📊 Thống Kê Ngân Hàng Câu Hỏi')
        .setColor(0x5865f2)
        .setDescription(
          `📦 **Tổng:** ${total} câu\n` +
          `✅ **Chưa dùng:** ${remaining} câu\n` +
          `✔️ **Đã gửi:** ${used} câu`
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: '❌ Lỗi hệ thống.', ephemeral: true });
    }
  }
});

// ====================== KHỞI ĐỘNG ======================
client.once('ready', async () => {
  console.log('='.repeat(50));
  debugLog('READY', `Bot ${client.user.tag} đã online!`);

  await initDB();

  const commands = [
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Xem thống kê thời gian học của ca hiện tại'),

    new SlashCommandBuilder()
      .setName('debug')
      .setDescription('[Admin] Test giao diện bot')
      .addStringOption(opt =>
        opt.setName('mode')
          .setDescription('Chọn tính năng muốn test')
          .setRequired(false)
          .addChoices(
            { name: 'Countdown kỳ thi', value: 'countdown' },
            { name: 'Daily Quiz',       value: 'quiz'      }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('addquestion')
      .setDescription('[Admin] Import ngân hàng câu hỏi từ file JSON')
      .addAttachmentOption(opt =>
        opt.setName('file')
          .setDescription('File .json chứa danh sách câu hỏi')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('quizstats')
      .setDescription('[Admin] Xem thống kê số câu hỏi còn lại trong kho')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    debugLog('READY', 'Đã đăng ký: /check, /debug, /addquestion, /quizstats');
  } catch (error) {
    debugLog('ERR', 'Lỗi đăng ký lệnh: ' + error.message);
  }

  const { isActive, dayKey } = getTrackingState();
  if (isActive) {
    debugLog('RECOVER', `Khôi phục tracking cho ngày ${dayKey}`);
    await startTrackingSession(dayKey);
  }

  console.log('='.repeat(50));
});

process.on('unhandledRejection', (reason) => {
  debugLog('CRITICAL_ERR', `Unhandled Rejection: ${reason}`);
});

client.login(TOKEN);