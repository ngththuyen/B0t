import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RESULT_CHANNEL_ID = process.env.RESULT_CHANNEL_ID || null;
const TIMEZONE = 'Asia/Ho_Chi_Minh';

// ==================== THỜI GIAN CẤU HÌNH ====================
const VOICE_START_TIME = process.env.VOICE_START_TIME || '20:00';
const VOICE_END_TIME   = process.env.VOICE_END_TIME   || '01:30';
const RESET_TIME       = process.env.RESET_TIME       || VOICE_END_TIME;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌ Thiếu DISCORD_TOKEN, CLIENT_ID hoặc GUILD_ID trong Variables');
  process.exit(1);
}

function parseTimeToCron(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.error(`❌ Sai định dạng thời gian: ${timeStr}. Phải là HH:MM`);
    process.exit(1);
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.error(`❌ Thời gian không hợp lệ: ${timeStr}`);
    process.exit(1);
  }
  return `${minute} ${hour} * * *`;
}

const startCronExpr = parseTimeToCron(VOICE_START_TIME);
const endCronExpr   = parseTimeToCron(VOICE_END_TIME);
const resetCronExpr = parseTimeToCron(RESET_TIME);

const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ]
});

let activePeriod = false;
let currentDayKey = null;
const voiceStartTimes = new Map(); // userId => startTime

// ====================== DEBUG HELPER ======================
function nowStr() {
  return new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE });
}

function debugLog(emoji, section, msg) {
  console.log(`${emoji}[${nowStr()}] [${section}] ${msg}`);
}

// ====================== DATABASE ======================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_progress (
        day_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        total_seconds INTEGER DEFAULT 0,
        PRIMARY KEY (day_key, user_id)
      );
    `);
    debugLog('✅', 'DB', 'Database sẵn sàng');
  } catch (err) {
    debugLog('❌', 'DB', `initDB thất bại: ${err.message}`);
    throw err;
  }
}

async function addVoiceTime(userId, seconds) {
  if (!currentDayKey || seconds <= 0) {
    debugLog('⚠️', 'DB', `addVoiceTime bỏ qua userId=${userId} | currentDayKey=${currentDayKey} | seconds=${seconds}`);
    return;
  }
  try {
    await pool.query(`
      INSERT INTO voice_progress (day_key, user_id, total_seconds)
      VALUES ($1, $2, $3)
      ON CONFLICT (day_key, user_id)
      DO UPDATE SET total_seconds = voice_progress.total_seconds + EXCLUDED.total_seconds
    `, [currentDayKey, userId, seconds]);
    debugLog('💽', 'DB', `Lưu userId=${userId} | +${seconds}s (${Math.floor(seconds/60)}p${seconds%60}s) | dayKey=${currentDayKey}`);
  } catch (err) {
    debugLog('❌', 'DB', `addVoiceTime thất bại userId=${userId}: ${err.message}`);
  }
}

// ====================== AUTO-SAVE MỖI 5 PHÚT ======================
async function autoSaveVoiceTime() {
  debugLog('🔍', 'AUTO-SAVE', `Bắt đầu auto-save | activePeriod=${activePeriod} | voiceStartTimes.size=${voiceStartTimes.size}`);

  if (voiceStartTimes.size === 0) {
    debugLog('ℹ️', 'AUTO-SAVE', 'Không có ai đang tracking → bỏ qua');
    return;
  }

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    debugLog('❌', 'AUTO-SAVE', `Không tìm thấy guild ID=${GUILD_ID}`);
    return;
  }

  const saved =[];
  const removed = [];
  const skipped = [];

  for (const [userId, startTime] of[...voiceStartTimes.entries()]) {
    const elapsedSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);

    let member = guild.members.cache.get(userId);
    if (!member) {
      debugLog('⚠️', 'AUTO-SAVE', `userId=${userId} không có trong cache → thử fetch...`);
      try {
        member = await guild.members.fetch(userId);
      } catch (err) {
        debugLog('❌', 'AUTO-SAVE', `Fetch thất bại userId=${userId}: ${err.message} → xóa khỏi tracking`);
        voiceStartTimes.delete(userId);
        removed.push(userId);
        continue;
      }
    }

    const username = member.user.username;
    const inVoice = !!member.voice?.channelId;

    if (inVoice) {
      if (elapsedSeconds >= 60) {
        await addVoiceTime(userId, elapsedSeconds);
        voiceStartTimes.set(userId, new Date()); // reset timer sau khi lưu
        const minutes = Math.floor(elapsedSeconds / 60);
        const secs = elapsedSeconds % 60;
        saved.push(`${username} (+${minutes}p${secs}s)`);
      } else {
        skipped.push(`${username} (${elapsedSeconds}s)`);
      }
    } else {
      debugLog('🚪', 'AUTO-SAVE', `${username} không còn trong voice → xóa khỏi tracking`);
      voiceStartTimes.delete(userId);
      removed.push(username);
    }
  }

  console.log('─'.repeat(60));
  if (saved.length > 0)    debugLog('💾', 'AUTO-SAVE', `✔ Đã lưu: ${saved.join(' | ')}`);
  if (skipped.length > 0)  debugLog('⏩', 'AUTO-SAVE', `⊘ Bỏ qua (< 1 phút): ${skipped.join(' | ')}`);
  if (removed.length > 0)  debugLog('🗑️', 'AUTO-SAVE', `✖ Đã xóa tracking: ${removed.join(' | ')}`);
  if (saved.length === 0 && skipped.length === 0 && removed.length === 0) {
    debugLog('ℹ️', 'AUTO-SAVE', 'Không có thay đổi nào');
  }
  debugLog('📊', 'AUTO-SAVE', `Còn ${voiceStartTimes.size} user đang được tracking`);
  console.log('─'.repeat(60));
}

// ====================== HÀM GỬI BẢNG KẾT QUẢ ======================
async function sendResultEmbed() {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;

  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (!channel) return;

  try {
    const data = await pool.query(
      'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',
      [currentDayKey]
    );

    const embed = new EmbedBuilder()
      .setTitle(`📊 KẾT QUẢ VOICE - ${currentDayKey}`)
      .setColor(0x00ff88)
      .setTimestamp();

    let desc = '';
    for (const row of data.rows) {
      const totalMin = Math.floor(row.total_seconds / 60);
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      const status = totalMin >= 150 ? '✅ **Hoàn thành**' : '⏳ Chưa hoàn thành';

      let username = row.user_id;
      try {
        const member = await client.guilds.cache.get(GUILD_ID).members.fetch(row.user_id);
        username = member.user.username;
      } catch {}

      desc += `**${username}** — ${hours}h ${mins}m — ${status}\n`;
    }

    embed.setDescription(desc || 'Chưa có ai tham gia voice trong ca này.');
    await channel.send({ embeds: [embed] });
    debugLog('📤', 'RESULT', `Đã gửi bảng kết quả ngày ${currentDayKey}`);
  } catch (err) {
    debugLog('❌', 'RESULT', `sendResultEmbed lỗi: ${err.message}`);
  }
}

// ====================== HELPER THỜI GIAN & KHÔI PHỤC ======================
function getTrackingState() {
  const now = new Date();
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const currentHour = localNow.getHours();
  const currentMin = localNow.getMinutes();
  const currentTime = currentHour * 60 + currentMin;

  const[startH, startM] = VOICE_START_TIME.split(':').map(Number);
  const[endH, endM] = VOICE_END_TIME.split(':').map(Number);

  const startTimeInMins = startH * 60 + startM;
  const endTimeInMins = endH * 60 + endM;

  let isActive = false;
  let dayOffset = 0;

  if (startTimeInMins < endTimeInMins) {
    isActive = currentTime >= startTimeInMins && currentTime < endTimeInMins;
  } else {
    // Xuyên đêm
    if (currentTime >= startTimeInMins) {
      isActive = true; 
    } else if (currentTime < endTimeInMins) {
      isActive = true; 
      dayOffset = -1; // Lùi về ca ngày hôm qua
    }
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
    try {
      await guild.members.fetch();
      debugLog('👥', 'START', `Đã fetch ${guild.members.cache.size} members vào cache`);
    } catch (err) {
      debugLog('⚠️', 'START', `Fetch members lỗi: ${err.message}`);
    }

    let countInVoice = 0;
    guild.members.cache.forEach(member => {
      if (member.voice?.channelId) {
        voiceStartTimes.set(member.id, new Date());
        countInVoice++;
        debugLog('🎙️', 'START', `Phát hiện ${member.user.username} đang trong voice kênh #${member.voice.channel?.name}`);
      }
    });
    debugLog('🚀', 'START', `Tracking BẮT ĐẦU | Ca: ${currentDayKey} | ${countInVoice} người đang trong voice`);
  }
}

// ====================== CRON JOBS ======================

// 1. Bắt đầu tracking
cron.schedule(startCronExpr, async () => {
  const localDate = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const dayKeyStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;
  await startTrackingSession(dayKeyStr);
}, { timezone: TIMEZONE });

// 2. Kết thúc tracking
cron.schedule(endCronExpr, async () => {
  debugLog('🏁', 'END', `Tracking KẾT THÚC | ${VOICE_END_TIME}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    const promises = [];
    for (const [userId, startTime] of voiceStartTimes.entries()) {
      const member = guild.members.cache.get(userId);
      if (member?.voice?.channelId) {
        const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
        promises.push(addVoiceTime(userId, seconds));
      }
    }
    await Promise.all(promises);
  }

  activePeriod = false;
  voiceStartTimes.clear();
  debugLog('✅', 'END', 'Đã lưu toàn bộ tiến trình cuối cùng.');
}, { timezone: TIMEZONE });

// 3. Auto-save mỗi 5 phút
cron.schedule('*/5 * * * *', async () => {
  debugLog('⏱️', 'CRON', 'Cron auto-save 5 phút kích hoạt');
  await autoSaveVoiceTime();
}, { timezone: TIMEZONE });

// 4. Reset + gửi bảng kết quả
cron.schedule(resetCronExpr, async () => {
  debugLog('🔄', 'RESET', `Reset bắt đầu | ${RESET_TIME}`);
  await sendResultEmbed();
  voiceStartTimes.clear();
  debugLog('✅', 'RESET', `Reset hoàn tất`);
}, { timezone: TIMEZONE });

// ====================== VOICE TRACKING ======================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.guild.id !== GUILD_ID) return;

  const wasInVoice = !!oldState.channelId;
  const isInVoice  = !!newState.channelId;
  const username   = member.user.username;

  if (!activePeriod) return;

  if (!wasInVoice && isInVoice) {
    // Vào voice
    voiceStartTimes.set(member.id, new Date());
    debugLog('🟢', 'VOICE', `${username} VÀO voice #${newState.channel?.name} | Đang tracking...`);

  } else if (wasInVoice && !isInVoice) {
    // Rời voice
    if (voiceStartTimes.has(member.id)) {
      const start = voiceStartTimes.get(member.id);
      const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
      await addVoiceTime(member.id, seconds);
      voiceStartTimes.delete(member.id);
      debugLog('🔴', 'VOICE', `${username} RỜI voice | +${seconds}s (${Math.floor(seconds/60)}p${seconds%60}s)`);
    }
  }
});

// ====================== COMMAND /check ======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'check') return;

  try {
    const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
    const dayKey = currentDayKey || (res.rows[0]?.day_key);

    if (!dayKey) {
      return interaction.reply({ content: '📭 Chưa có dữ liệu tiến độ nào.', ephemeral: true });
    }

    const data = await pool.query(
      'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',
      [dayKey]
    );

    const embed = new EmbedBuilder()
      .setTitle(`📊 BẢNG TOP VOICE - ${dayKey}`)
      .setColor(0x00ff88)
      .setTimestamp();

    let desc = '';
    for (const row of data.rows) {
      const totalMin = Math.floor(row.total_seconds / 60);
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      const status = totalMin >= 150 ? '✅ **Hoàn thành**' : '⏳ Chưa hoàn thành';

      let username = row.user_id;
      try {
        const member = await interaction.guild.members.fetch(row.user_id);
        username = member.user.username;
      } catch {}

      desc += `**${username}** — ${hours}h ${mins}m — ${status}\n`;
    }

    embed.setDescription(desc || 'Chưa có ai tham gia voice.');
    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    await interaction.reply({ content: '❌ Lỗi khi lấy dữ liệu. Vui lòng thử lại.', ephemeral: true });
  }
});

// ====================== READY ======================
client.once('ready', async () => {
  console.log('═'.repeat(60));
  debugLog('✅', 'READY', `Bot online: ${client.user.tag}`);
  debugLog('⚙️', 'READY', `Start=${VOICE_START_TIME} | End=${VOICE_END_TIME} | Reset=${RESET_TIME}`);
  console.log('═'.repeat(60));

  await initDB();

  // Khôi phục trạng thái tracking nếu bot lỡ bị restart giữa chừng
  const { isActive, dayKey } = getTrackingState();
  if (isActive) {
    debugLog('🔄', 'RECOVER', `Bot chạy lúc đang trong ca, khôi phục ca: ${dayKey}...`);
    await startTrackingSession(dayKey);
  } else {
    debugLog('⏸️', 'RECOVER', 'Bot chạy ngoài giờ tracking. Chờ đến giờ cron sẽ tự động kích hoạt.');
  }

  const commands =[
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Xem bảng top voice của toàn server')
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    debugLog('✅', 'READY', 'Lệnh /check đã đăng ký');
  } catch (error) {
    debugLog('❌', 'READY', `Lỗi đăng ký lệnh: ${error.message}`);
  }
});

// ====================== XỬ LÝ LỖI TOÀN CỤC ======================
process.on('unhandledRejection', (reason) => {
  debugLog('💥', 'ERROR', `Unhandled Promise Rejection: ${reason}`);
});

client.login(TOKEN);