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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ]
});

let activePeriod = false;
let currentDayKey = null;
const voiceStartTimes = new Map(); // userId => startTime

// ====================== DATABASE ======================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_progress (
      day_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (day_key, user_id)
    );
  `);
  console.log('✅ Database sẵn sàng');
}

async function addVoiceTime(userId, seconds) {
  if (!currentDayKey || seconds <= 0) return;
  await pool.query(`
    INSERT INTO voice_progress (day_key, user_id, total_seconds)
    VALUES ($1, $2, $3)
    ON CONFLICT (day_key, user_id)
    DO UPDATE SET total_seconds = voice_progress.total_seconds + EXCLUDED.total_seconds
  `, [currentDayKey, userId, seconds]);
}

// ====================== AUTO-SAVE MỖI 5 PHÚT ======================
async function autoSaveVoiceTime() {
  if (!activePeriod || voiceStartTimes.size === 0) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  let savedCount = 0;
  for (const [userId, startTime] of voiceStartTimes.entries()) {
    const member = guild.members.cache.get(userId);
    if (member && member.voice?.channel) {
      const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
      if (seconds > 0) {
        await addVoiceTime(userId, seconds);
        voiceStartTimes.set(userId, new Date()); // reset start time
        savedCount++;
      }
    } else {
      voiceStartTimes.delete(userId);
    }
  }
  if (savedCount > 0) {
    console.log(`💾 Auto-save mỗi 5 phút: Đã lưu ${savedCount} user`);
  }
}

// ====================== HÀM GỬI BẢNG KẾT QUẢ ======================
async function sendResultEmbed() {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;

  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (!channel) {
    console.error(`❌ Không tìm thấy channel ID: ${RESULT_CHANNEL_ID}`);
    return;
  }

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
    const timeStr = `${hours}h ${mins}m`;
    const status = totalMin >= 150 ? '✅ **Hoàn thành**' : '⏳ Chưa hoàn thành';
    
    let username = row.user_id;
    try {
      const member = await client.guilds.cache.get(GUILD_ID).members.fetch(row.user_id);
      username = member.user.username;
    } catch {}
    
    desc += `**${username}** — ${timeStr} — ${status}\n`;
  }

  embed.setDescription(desc || 'Chưa có ai tham gia voice trong ngày này.');
  await channel.send({ embeds: [embed] });
  console.log(`📤 Đã gửi bảng kết quả ngày ${currentDayKey}`);
}

// ====================== CRON JOBS ======================
const getDayKey = () => {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
};

// 1. Bắt đầu tracking
cron.schedule(startCronExpr, async () => {
  currentDayKey = getDayKey();
  activePeriod = true;
  voiceStartTimes.clear();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    guild.members.cache.forEach(member => {
      if (member.voice?.channel) voiceStartTimes.set(member.id, new Date());
    });
  }
  console.log(`🚀 Tracking voice BẮT ĐẦU - ${VOICE_START_TIME} - Ngày: ${currentDayKey}`);
}, { timezone: TIMEZONE });

// 2. Kết thúc tracking
cron.schedule(endCronExpr, async () => {
  if (!activePeriod) return;
  activePeriod = false;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    guild.members.cache.forEach(async member => {
      if (member.voice?.channel && voiceStartTimes.has(member.id)) {
        const start = voiceStartTimes.get(member.id);
        const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
        await addVoiceTime(member.id, seconds);
      }
    });
  }
  console.log(`🏁 Tracking voice KẾT THÚC - ${VOICE_END_TIME}`);
}, { timezone: TIMEZONE });

// 3. Auto-save mỗi 5 phút
cron.schedule('*/5 * * * *', async () => {
  await autoSaveVoiceTime();
}, { timezone: TIMEZONE });

// 4. Reset + gửi bảng kết quả
cron.schedule(resetCronExpr, async () => {
  await sendResultEmbed();
  voiceStartTimes.clear();
  console.log(`🔄 RESET hoàn tất lúc ${RESET_TIME}`);
}, { timezone: TIMEZONE });

// ====================== VOICE TRACKING ======================
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;
  if (!member || member.guild.id !== GUILD_ID || !activePeriod) return;

  const wasInVoice = !!oldState.channelId;
  const isInVoice = !!newState.channelId;

  if (!wasInVoice && isInVoice) {
    voiceStartTimes.set(member.id, new Date());
  } else if (wasInVoice && !isInVoice) {
    if (voiceStartTimes.has(member.id)) {
      const start = voiceStartTimes.get(member.id);
      const seconds = Math.floor((Date.now() - start.getTime()) / 1000);
      await addVoiceTime(member.id, seconds);
      voiceStartTimes.delete(member.id);
    }
  }
});

// ====================== COMMAND /check (TOP TOÀN SERVER) ======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'check') return;

  const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
  const dayKey = currentDayKey || (res.rows[0]?.day_key);

  if (!dayKey) {
    return interaction.reply({ content: '📭 Chưa có dữ liệu tiến độ nào trong ngày hôm nay.', ephemeral: true });
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
    const timeStr = `${hours}h ${mins}m`;
    const status = totalMin >= 150 ? '✅ **Hoàn thành**' : '⏳ Chưa hoàn thành';
    
    let username = row.user_id;
    try {
      const member = await interaction.guild.members.fetch(row.user_id);
      username = member.user.username;
    } catch {}
    
    desc += `**${username}** — ${timeStr} — ${status}\n`;
  }

  embed.setDescription(desc || 'Chưa có ai tham gia voice trong ngày này.');
  await interaction.reply({ embeds: [embed] });
});

// ====================== READY ======================
client.once('ready', async () => {
  console.log(`✅ Bot đã online - ${client.user.tag}`);
  console.log(`⏰ Cấu hình: Start=${VOICE_START_TIME} | End=${VOICE_END_TIME} | Reset=${RESET_TIME} | Auto-save: 5 phút`);
  if (RESULT_CHANNEL_ID) console.log(`📤 Kết quả sẽ gửi vào channel: ${RESULT_CHANNEL_ID}`);
  
  await initDB();

  const commands = [
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Xem bảng top voice của toàn server')
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('✅ Lệnh /check đã đăng ký');
});

client.login(TOKEN);