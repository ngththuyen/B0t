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

// ==================== PALETTE MÀU CHUẨN ====================
const COLORS = {
  PRIMARY:    0x5865f2,
  SUCCESS:    0x57f287,
  WARNING:    0xfee75c,
  DANGER:     0xed4245,
  INFO:       0x3ba55d,
  DARK:       0x2b2d31,
  GOLD:       0xffd700,
  SILVER:     0xc0c0c0,
  BRONZE:     0xcd7f32,
  ORANGE:     0xf47fff,
};

// ==================== DATA CỐ ĐỊNH ====================
const EXAMS = [
  { name: 'Kỳ thi Đánh giá Năng Lực (VACT) - Đợt 2', date: new Date('2026-05-24T08:30:00+07:00') },
  { name: 'Kỳ thi Tốt nghiệp THPT Quốc Gia 2026',    date: new Date('2026-06-11T07:30:00+07:00') }
];

const ENGLISH_TIPS = [
  {
    en:   '"Never give up on your dreams, no matter how difficult things get."',
    vi:   'Đừng bao giờ từ bỏ ước mơ, dù mọi thứ có khó khăn đến đâu.',
    tag:  'Phrasal Verb',
    note: 'give up (on sth) = từ bỏ. Trái nghĩa: keep going / persist.'
  },
  {
    en:   '"You need to keep up with the latest knowledge if you want to stand out."',
    vi:   'Bạn cần theo kịp kiến thức mới nhất nếu muốn nổi bật.',
    tag:  'Phrasal Verb',
    note: 'keep up with = theo kịp | stand out = nổi bật, khác biệt.'
  },
  {
    en:   '"I am looking forward to seeing the results of all my hard work."',
    vi:   'Tôi đang mong chờ được thấy kết quả của tất cả công sức của mình.',
    tag:  'Phrasal Verb',
    note: 'look forward to + V-ing (không dùng to V). Cấu trúc hay bị nhầm trong thi!'
  },
  {
    en:   '"Stop putting off your revision — the exam is just around the corner."',
    vi:   'Hãy ngừng trì hoãn việc ôn bài — kỳ thi đã gần kề rồi.',
    tag:  'Phrasal Verb',
    note: 'put off + V-ing = trì hoãn. "just around the corner" = sắp đến nơi.'
  },
  {
    en:   '"She had to go through many hardships before she finally succeeded."',
    vi:   'Cô ấy phải trải qua nhiều gian khó trước khi cuối cùng thành công.',
    tag:  'Phrasal Verb',
    note: 'go through = trải qua (khó khăn, thử thách). go through + noun.'
  },
  {
    en:   '"Extra practice can make up for the time you lost earlier."',
    vi:   'Luyện tập thêm có thể bù đắp cho thời gian bạn đã lãng phí trước đó.',
    tag:  'Phrasal Verb',
    note: 'make up for sth = bù đắp, bù lại cho điều gì đó.'
  },
  {
    en:   '"It is never too late to catch up with your classmates if you work smart."',
    vi:   'Không bao giờ là quá muộn để bắt kịp các bạn cùng lớp nếu bạn học đúng cách.',
    tag:  'Phrasal Verb',
    note: 'catch up with = bắt kịp. "It is never too late to + V" — cấu trúc phổ biến.'
  },
  {
    en:   '"He decided to take up a new language to broaden his horizons."',
    vi:   'Anh ấy quyết định bắt đầu học một ngôn ngữ mới để mở rộng tầm nhìn.',
    tag:  'Phrasal Verb',
    note: 'take up = bắt đầu một thói quen/sở thích mới. broaden horizons = collocation.'
  },
  {
    en:   '"They came up with a creative solution to the problem together."',
    vi:   'Họ cùng nhau nghĩ ra một giải pháp sáng tạo cho vấn đề.',
    tag:  'Phrasal Verb',
    note: 'come up with = nghĩ ra, đề xuất (ý tưởng/giải pháp).'
  },
  {
    en:   '"Do not turn down any opportunity to learn something new."',
    vi:   'Đừng từ chối bất kỳ cơ hội nào để học điều gì đó mới.',
    tag:  'Phrasal Verb',
    note: 'turn down = từ chối (lời đề nghị, cơ hội). Khác với refuse (dùng cho request).'
  },
  {
    en:   '"You can get over any obstacle if you believe in yourself."',
    vi:   'Bạn có thể vượt qua bất kỳ trở ngại nào nếu bạn tin vào bản thân.',
    tag:  'Phrasal Verb',
    note: 'get over = vượt qua (khó khăn, nỗi đau). believe in yourself = tin vào bản thân.'
  },
  {
    en:   '"Do not run out of time during the exam — manage it wisely."',
    vi:   'Đừng để hết thời gian trong kỳ thi — hãy quản lý thời gian khôn ngoan.',
    tag:  'Phrasal Verb',
    note: 'run out of = hết (thứ gì đó). run out of time/money/energy.'
  },
  {
    en:   '"Make progress every single day, even if the steps are small."',
    vi:   'Hãy tiến bộ mỗi ngày, dù những bước tiến chỉ nhỏ thôi.',
    tag:  'Collocation',
    note: 'make progress (✓) — KHÔNG nói "do progress". Collocation cố định!'
  },
  {
    en:   '"Pay close attention to grammar rules — they decide your score."',
    vi:   'Hãy chú ý kỹ các quy tắc ngữ pháp — chúng quyết định điểm số của bạn.',
    tag:  'Collocation',
    note: 'pay attention to (✓) — KHÔNG nói "give attention". pay + attention = cặp cố định.'
  },
  {
    en:   '"Take responsibility for your own learning — nobody can do it for you."',
    vi:   'Hãy chịu trách nhiệm cho việc học của chính bạn — không ai có thể làm thay bạn.',
    tag:  'Collocation',
    note: 'take responsibility for sth (✓) — KHÔNG nói "make responsibility".'
  },
  {
    en:   '"Reading widely helps you gain knowledge and broaden your vocabulary."',
    vi:   'Đọc sách rộng rãi giúp bạn thu nhận kiến thức và mở rộng vốn từ vựng.',
    tag:  'Collocation',
    note: 'gain knowledge/experience/skills (✓) | broaden vocabulary (✓) — cặp collocation phổ biến.'
  },
  {
    en:   '"Make an effort to review your notes every night before you sleep."',
    vi:   'Hãy cố gắng ôn lại ghi chú của bạn mỗi tối trước khi ngủ.',
    tag:  'Collocation',
    note: 'make an effort (✓) — KHÔNG nói "do an effort". Cũng có: make a great/strong effort.'
  },
  {
    en:   '"A single hour of focused study can make a real difference."',
    vi:   'Chỉ một tiếng đồng hồ học tập tập trung có thể tạo ra sự khác biệt thực sự.',
    tag:  'Collocation',
    note: 'make a difference (✓) — tạo ra sự khác biệt. Cũng dùng: make a big/real difference.'
  },
  {
    en:   '"Face challenges with courage and you will fulfill your full potential."',
    vi:   'Đối mặt với thử thách bằng dũng cảm và bạn sẽ phát huy hết tiềm năng của mình.',
    tag:  'Collocation',
    note: 'face challenges (✓) | fulfill potential (✓) — hai collocation quan trọng.'
  },
  {
    en:   '"Burning the midnight oil helped him achieve his academic goals."',
    vi:   'Thức khuya học bài đã giúp anh ấy đạt được mục tiêu học tập.',
    tag:  'Collocation + Idiom',
    note: 'burn the midnight oil = thức khuya làm việc/học. achieve goals (✓) — KHÔNG nói "reach" khi nói về mục tiêu học tập.'
  },
  {
    en:   '"If you study hard, you will pass the exam with flying colours."',
    vi:   'Nếu bạn học chăm chỉ, bạn sẽ vượt qua kỳ thi một cách xuất sắc.',
    tag:  'Conditional Type 1',
    note: 'If + S + V(s/es), S + will + V. "with flying colours" = đậu xuất sắc.'
  },
  {
    en:   '"If I were in your shoes, I would never give up on my dreams."',
    vi:   'Nếu tôi ở vị trí của bạn, tôi sẽ không bao giờ từ bỏ ước mơ của mình.',
    tag:  'Conditional Type 2',
    note: 'If + S + were/V-ed, S + would + V. "in your shoes" = ở vị trí của bạn — hay dùng!'
  },
  {
    en:   '"If she had started earlier, she would have avoided so much stress."',
    vi:   'Nếu cô ấy bắt đầu sớm hơn, cô ấy đã không phải chịu nhiều áp lực như vậy.',
    tag:  'Conditional Type 3',
    note: 'If + S + had + V3, S + would have + V3. Diễn tả điều KHÔNG xảy ra trong quá khứ.'
  },
  {
    en:   '"I wish I had paid more attention in class last year."',
    vi:   'Tôi ước gì mình đã chú ý hơn trong lớp năm ngoái.',
    tag:  'Wish Sentence (past)',
    note: 'wish + S + had + V3 = ước điều đã không xảy ra trong quá khứ. Khác với "I wish I could...".'
  },
  {
    en:   '"Great things are achieved by those who refuse to stop trying."',
    vi:   'Những điều vĩ đại được thực hiện bởi những người từ chối ngừng cố gắng.',
    tag:  'Passive Voice',
    note: 'S + am/is/are + V3. Bị động thì hiện tại đơn. "refuse to + V" = từ chối làm gì.'
  },
  {
    en:   '"This exam has been taken by millions of students over the years."',
    vi:   'Kỳ thi này đã được hàng triệu học sinh tham dự trong nhiều năm qua.',
    tag:  'Passive Voice',
    note: 'S + has/have + been + V3. Bị động thì hiện tại hoàn thành.'
  },
  {
    en:   '"Students who work consistently are the ones who achieve the best results."',
    vi:   'Những học sinh học đều đặn là những người đạt được kết quả tốt nhất.',
    tag:  'Relative Clause',
    note: 'who = đại từ quan hệ thay thế cho người (subject). Không dùng "which" cho người.'
  },
  {
    en:   '"The knowledge that you gain today is an investment in your future."',
    vi:   'Kiến thức mà bạn thu nhận hôm nay là một khoản đầu tư cho tương lai của bạn.',
    tag:  'Relative Clause',
    note: 'that/which = đại từ quan hệ thay thế cho vật. Có thể bỏ "that" khi nó là tân ngữ.'
  },
  {
    en:   '"Avoid making the same mistake twice — learning from failure is key."',
    vi:   'Tránh mắc cùng một lỗi hai lần — học hỏi từ thất bại là điều then chốt.',
    tag:  'Gerund',
    note: 'avoid + V-ing (✓). Nhóm động từ + V-ing: avoid, enjoy, mind, consider, suggest...'
  },
  {
    en:   '"Remember to review your answers before handing in your exam paper."',
    vi:   'Hãy nhớ kiểm tra lại đáp án trước khi nộp bài thi.',
    tag:  'Gerund vs To-inf',
    note: 'remember to V = nhớ để làm (tương lai). remember V-ing = nhớ lại đã làm (quá khứ).'
  },
  {
    en:   '"He tried to concentrate on studying despite the loud noise outside."',
    vi:   'Anh ấy cố gắng tập trung vào việc học dù có tiếng ồn lớn bên ngoài.',
    tag:  'To-Infinitive',
    note: 'try to V = cố gắng làm. Khác với try V-ing = thử làm xem sao. concentrate on + V-ing.'
  },
  {
    en:   '"She was so determined that nothing could stop her from reaching her goal."',
    vi:   'Cô ấy quyết tâm đến mức không gì có thể ngăn cô ấy đạt được mục tiêu.',
    tag:  'So...That',
    note: 'so + adj/adv + that + clause. Còn có: such + a/an + adj + noun + that.'
  },
  {
    en:   '"Not only does hard work build skills, but it also builds character."',
    vi:   'Làm việc chăm chỉ không chỉ xây dựng kỹ năng, mà còn rèn luyện nhân cách.',
    tag:  'Not only...but also (Đảo ngữ)',
    note: 'Not only + auxiliary + S + V, but S + also + V. Đảo ngữ với "not only" ở đầu câu!'
  },
  {
    en:   '"The harder you work now, the easier the exam will be on the day."',
    vi:   'Bạn càng nỗ lực nhiều hơn bây giờ, kỳ thi sẽ càng dễ dàng hơn vào ngày đó.',
    tag:  'Double Comparative',
    note: 'The + comparative, the + comparative = càng... càng... Cấu trúc THPTQG rất hay ra!'
  },
  {
    en:   '"Despite feeling nervous, she walked in and gave her best performance."',
    vi:   'Mặc dù cảm thấy lo lắng, cô ấy bước vào và thể hiện tốt nhất có thể.',
    tag:  'Despite / In spite of',
    note: 'despite / in spite of + N / V-ing. KHÔNG dùng despite + clause (phải dùng although).'
  },
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

function createProgressBar(current, max, length = 15) {
  const filled = Math.max(0, Math.min(length, Math.round((current / max) * length)));
  const empty = length - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.min(100, Math.round((current / max) * 100));
  return `${bar} ${percent}%`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getRankEmoji(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return `\`${String(index + 1).padStart(2, '0')}.\``;
}

function getRankColor(index) {
  if (index === 0) return COLORS.GOLD;
  if (index === 1) return COLORS.SILVER;
  if (index === 2) return COLORS.BRONZE;
  return COLORS.PRIMARY;
}

// ====================== DATABASE ======================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_progress (
      day_key       TEXT    NOT NULL,
      user_id       TEXT    NOT NULL,
      total_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (day_key, user_id)
    );
  `);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL,
      question_id   TEXT NOT NULL,
      chosen        TEXT NOT NULL,
      is_correct    BOOLEAN NOT NULL,
      answered_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, question_id)
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

// ====================== LEADERBOARD EMBEDS ======================
async function buildLeaderboardEmbed(dayKey) {
  const data = await pool.query(
    'SELECT user_id, total_seconds FROM voice_progress WHERE day_key = $1 ORDER BY total_seconds DESC',
    [dayKey]
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('📊 THỐNG KÊ THỜI GIAN HỌC')
    .setDescription(`-# Ngày: **${dayKey}**`)
    .setTimestamp();

  if (data.rows.length === 0) {
    embed.setColor(COLORS.WARNING);
    embed.addFields({
      name: 'ℹ️ Chưa có dữ liệu',
      value: 'Chưa có dữ liệu ghi nhận trong ca học này.\nHãy tham gia voice channel để bắt đầu ghi nhận!'
    });
    return embed;
  }

  await Promise.all(data.rows.map(async (row) => {
    try {
      const user = await client.users.fetch(row.user_id);
      row.username = user.username;
      row.avatar = user.displayAvatarURL({ size: 64 });
    } catch {
      row.username = `User#${row.user_id.slice(-4)}`;
      row.avatar = null;
    }
  }));

  const totalParticipants = data.rows.length;
  const totalTime = data.rows.reduce((sum, r) => sum + r.total_seconds, 0);

  embed.addFields(
    { name: '👥 Thành viên', value: `\`${totalParticipants}\` người`, inline: true },
    { name: '⏱️ Tổng thời gian', value: `\`${formatDuration(totalTime)}\``, inline: true },
    { name: '\u200b', value: '\u200b', inline: true }
  );

  embed.addFields({ name: '\u200b', value: '**🏆 BẢNG XẾP HẠNG**' });

  data.rows.slice(0, 3).forEach((row, index) => {
    const hours = Math.floor(row.total_seconds / 3600);
    const mins = Math.floor((row.total_seconds % 3600) / 60);
    const progressBar = createProgressBar(row.total_seconds, 9000, 10);

    embed.addFields({
      name: `${getRankEmoji(index)} ${row.username}`,
      value:
        `\`\`\`yaml\n` +
        `Thời gian: ${hours}h ${String(mins).padStart(2, '0')}m\n` +
        `Tiến độ:  ${progressBar}\n` +
        `\`\`\``,
      inline: false
    });
  });

  if (data.rows.length > 3) {
    const others = data.rows.slice(3);
    let othersText = '';
    others.forEach((row, idx) => {
      const dur = formatDuration(row.total_seconds);
      othersText += `${getRankEmoji(idx + 3)} **${row.username}** — \`${dur}\`\n`;
    });
    embed.addFields({
      name: '📋 Các vị trí còn lại',
      value: othersText || '\u200b',
      inline: false
    });
  }

  embed.setFooter({ text: '🎯 Ca học: 20:00 - 01:30 | Tự động cập nhật mỗi 5 phút' });
  return embed;
}

// ====================== COUNTDOWN FEATURE ======================
function buildCountdownEmbed() {
  const now = new Date();
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('⏳ ĐẾM NGƯỢC KỲ THI')
    .setDescription('-# Cập nhật mỗi ngày lúc 00:00')
    .setTimestamp();

  for (const exam of EXAMS) {
    const unixTime = Math.floor(exam.date.getTime() / 1000);
    const diffTime = exam.date - now;

    if (diffTime > 0) {
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const progressBar = createProgressBar(Math.max(0, 365 - days), 365, 12);

      embed.addFields({
        name: `📌 ${exam.name}`,
        value:
          `> ⏰ **Thời gian:** <t:${unixTime}:F>\n` +
          `> ⏳ **Còn lại:** **${days}** ngày ${hours}h (<t:${unixTime}:R>)\n` +
          `> 📈 **Tiến độ năm:** \`${progressBar}\``,
        inline: false
      });
    } else {
      embed.addFields({
        name: `📌 ${exam.name}`,
        value: `> ✅ *Kỳ thi đã diễn ra vào <t:${unixTime}:D>!*`,
        inline: false
      });
    }
  }

  return embed;
}

function buildEnglishTipEmbed() {
  const tip = ENGLISH_TIPS[Math.floor(Math.random() * ENGLISH_TIPS.length)];

  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📖 English Tip of the Day')
    .setDescription(
      `### 🏷️ ${tip.tag}\n\n` +
      `> *${tip.en}*\n\n` +
      `🇻🇳 **Dịch nghĩa:**\n${tip.vi}\n\n` +
      `💡 **Ghi chú:**\n\`\`\`fix\n${tip.note}\n\`\`\``
    )
    .setFooter({ text: '📚 Ôn tập mỗi ngày một chút — tích tiểu thành đại!' })
    .setTimestamp();
}

// ====================== QUIZ FEATURE ======================
async function importQuestionsFromJSON(questions) {
  let inserted = 0;
  let skipped  = 0;

  for (const q of questions) {
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

async function sendDailyQuiz(channelId = COUNTDOWN_CHANNEL_ID) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) return debugLog('QUIZ', 'Không tìm thấy kênh Quiz.');

  const res = await pool.query(
    'SELECT * FROM quiz_questions WHERE sent_at IS NULL ORDER BY RANDOM() LIMIT 1'
  );

  if (res.rows.length === 0) {
    debugLog('QUIZ', '⚠️ Ngân hàng câu hỏi đã hết!');
    const warnEmbed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⚠️ Hết câu hỏi')
      .setDescription('Ngân hàng câu hỏi đã hết! Admin vui lòng dùng `/addquestion` để bổ sung.')
      .setFooter({ text: '💡 Sử dụng /quizstats để xem thống kê kho câu hỏi' });
    await channel.send({ embeds: [warnEmbed] });
    return;
  }

  const q = res.rows[0];

  // Đánh dấu đã gửi (không dùng cho expiry, chỉ để tránh gửi trùng)
  await pool.query(
    'UPDATE quiz_questions SET sent_at = NOW() WHERE id = $1',
    [q.id]
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.ORANGE)
    .setTitle(`📝 DAILY QUIZ — ${q.subject.toUpperCase()}`)
    .setDescription(
      `### ❓ Câu hỏi\n${q.question}\n\n` +
      `**A.** ${q.options.A}\n` +
      `**B.** ${q.options.B}\n` +
      `**C.** ${q.options.C}\n` +
      `**D.** ${q.options.D}\n\n` +
      `💡 Mỗi câu chỉ trả lời **1 lần**!`
    )
    .setFooter({ text: '⏱️ Chọn đáp án bên dưới — chỉ bạn thấy kết quả!' })
    .setTimestamp();

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
cron.schedule(parseTimeToCron(VOICE_START_TIME), async () => {
  const { dayKey } = getTrackingState();
  await startTrackingSession(dayKey);
}, { timezone: TIMEZONE });

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

cron.schedule(parseTimeToCron(RESET_TIME), async () => {
  if (!currentDayKey || !RESULT_CHANNEL_ID) return;
  const channel = client.channels.cache.get(RESULT_CHANNEL_ID);
  if (channel) {
    const embed = await buildLeaderboardEmbed(currentDayKey);
    await channel.send({ embeds: [embed] });
    debugLog('RESULT', `Đã gửi bảng thành tích ngày ${currentDayKey}`);
  }
}, { timezone: TIMEZONE });

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

cron.schedule('0 0 * * *', async () => {
  const channel = client.channels.cache.get(COUNTDOWN_CHANNEL_ID);
  if (!channel) {
    debugLog('COUNTDOWN', 'Không tìm thấy kênh đếm ngược.');
    return;
  }

  await channel.send({ embeds: [buildCountdownEmbed()] });
  await channel.send({ embeds: [buildEnglishTipEmbed()] });

  debugLog('COUNTDOWN', 'Đã gửi thông báo đếm ngược + English Tip lúc nửa đêm.');
}, { timezone: TIMEZONE });

// ── Lịch Quiz: 15 lần/ngày (dàn trải đều) ──
const QUIZ_SCHEDULE = [
  '0  6  * * *',   // 06:00 — Sáng sớm
  '10 7  * * *',   // 07:10
  '55 8  * * *',   // 08:55
  '40 10 * * *',   // 10:40
  '30 11 * * *',   // 11:30 — Trước giờ nghỉ trưa
  '20 13 * * *',   // 13:20
  '30 14 * * *',   // 14:30 — Đầu giờ chiều
  '5  16 * * *',   // 16:05
  '30 17 * * *',   // 17:30 — Sau giờ tan học/làm
  '0  19 * * *',   // 19:00
  '50 19 * * *',   // 19:50
  '45 20 * * *',   // 20:45
  '40 21 * * *',   // 21:40
  '35 22 * * *',   // 22:35
  '0  23 * * *',   // 23:00 — Khuya
];

for (const cronExpr of QUIZ_SCHEDULE) {
  cron.schedule(cronExpr, async () => {
    debugLog('CRON', `Tới giờ gửi Daily Quiz! (${cronExpr.trim()})`);
    await sendDailyQuiz();
  }, { timezone: TIMEZONE });
}

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
    const parts  = interaction.customId.split('_');
    const chosen = parts.pop();
    const qId    = parts.slice(1).join('_');

    const attemptRes = await pool.query(
      'SELECT * FROM quiz_attempts WHERE user_id = $1 AND question_id = $2',
      [interaction.user.id, qId]
    );

    if (attemptRes.rows.length > 0) {
      const prev = attemptRes.rows[0];
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⚠️ Đã trả lời')
        .setDescription(
          `Bạn đã trả lời câu này rồi!\n\n` +
          `Lựa chọn trước: **${prev.chosen}**\n` +
          `Kết quả: ${prev.is_correct ? '✅ Đúng' : '❌ Sai'}`
        )
        .setFooter({ text: 'Mỗi câu chỉ được trả lời 1 lần!' });
      return interaction.reply({ embeds: [errEmbed], ephemeral: true });
    }

    const res = await pool.query('SELECT * FROM quiz_questions WHERE id = $1', [qId]);
    const q   = res.rows[0];

    if (!q) {
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('❌ Lỗi')
        .setDescription('Câu hỏi này không tồn tại hoặc bị lỗi dữ liệu!');
      return interaction.reply({ embeds: [errEmbed], ephemeral: true });
    }

    const isCorrect = chosen === q.correct;

    await pool.query(`
      INSERT INTO quiz_attempts (user_id, question_id, chosen, is_correct)
      VALUES ($1, $2, $3, $4)
    `, [interaction.user.id, qId, chosen, isCorrect]);

    const replyEmbed = new EmbedBuilder()
      .setTitle(isCorrect ? '✅ CHÍNH XÁC!' : '❌ RẤT TIẾC!')
      .setColor(isCorrect ? COLORS.SUCCESS : COLORS.DANGER)
      .setDescription(
        `Bạn chọn: **${chosen}** — ${q.options[chosen]}\n\n` +
        `Đáp án đúng: **${q.correct}** — ${q.options[q.correct]}`
      )
      .setFooter({
        text: isCorrect
          ? 'Tuyệt vời! Hãy tiếp tục phát huy nhé!'
          : 'Cố gắng lên lần sau nhé!'
      });

    return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;

  // ── /check ──
  if (interaction.commandName === 'check') {
    try {
      const res = await pool.query('SELECT day_key FROM voice_progress ORDER BY day_key DESC LIMIT 1');
      const targetDayKey = currentDayKey || res.rows[0]?.day_key;
      if (!targetDayKey) {
        const emptyEmbed = new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle('📭 Chưa có dữ liệu')
          .setDescription('Chưa có dữ liệu ghi nhận nào. Hãy tham gia voice channel trong ca học để bắt đầu!');
        return interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
      }
      const embed = await buildLeaderboardEmbed(targetDayKey);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      debugLog('CMD_ERR', `Lỗi /check: ${err.message}`);
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('❌ Lỗi hệ thống')
        .setDescription('Đã xảy ra lỗi, vui lòng thử lại sau.');
      await interaction.reply({ embeds: [errEmbed], ephemeral: true });
    }
  }

  // ── /debug ──
  if (interaction.commandName === 'debug') {
    const mode = interaction.options.getString('mode') || 'countdown';
    if (mode === 'quiz') {
      const loadingEmbed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setDescription('⏳ Đang tải câu hỏi thử...');
      await interaction.reply({ embeds: [loadingEmbed], ephemeral: true });
      await sendDailyQuiz(interaction.channelId);
    } else if (mode === 'countdown') {
      await interaction.reply({ embeds: [buildCountdownEmbed()] });
    } else if (mode === 'tip') {
      await interaction.reply({ embeds: [buildEnglishTipEmbed()] });
    } else {
      await interaction.reply({ embeds: [buildCountdownEmbed()] });
      await interaction.followUp({ embeds: [buildEnglishTipEmbed()], ephemeral: true });
    }
  }

  // ── /addquestion ──
  if (interaction.commandName === 'addquestion') {
    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.json')) {
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('❌ Sai định dạng')
        .setDescription('Vui lòng đính kèm file `.json`!');
      return interaction.editReply({ embeds: [errEmbed] });
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`Không tải được file: ${response.statusText}`);

      const text      = await response.text();
      const questions = JSON.parse(text);

      if (!Array.isArray(questions)) {
        const errEmbed = new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setTitle('❌ Sai cấu trúc')
          .setDescription('File JSON phải là một **mảng** (array) các câu hỏi!');
        return interaction.editReply({ embeds: [errEmbed] });
      }

      const { inserted, skipped } = await importQuestionsFromJSON(questions);

      const countRes = await pool.query('SELECT COUNT(*) FROM quiz_questions WHERE sent_at IS NULL');
      const remaining = countRes.rows[0].count;

      const resultEmbed = new EmbedBuilder()
        .setTitle('📚 Kết quả Import')
        .setColor(COLORS.SUCCESS)
        .setDescription(
          `✅ **Thêm mới:** \`${inserted}\` câu\n` +
          `⏭️ **Bỏ qua:** \`${skipped}\` câu\n\n` +
          `📦 **Tổng câu chưa dùng:** \`${remaining}\` câu`
        )
        .setFooter({ text: `Thực hiện bởi ${interaction.user.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed] });
      debugLog('QUIZ_IMPORT', `Admin ${interaction.user.username} đã import: +${inserted} câu, bỏ qua ${skipped} câu.`);

    } catch (err) {
      debugLog('QUIZ_IMPORT_ERR', err.message);
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('❌ Lỗi đọc file')
        .setDescription(`\`${err.message}\``);
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  // ── /quizstats ──
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
        .setColor(COLORS.PRIMARY)
        .addFields(
          { name: '📦 Tổng câu hỏi', value: `\`${total}\``, inline: true },
          { name: '✅ Chưa dùng', value: `\`${remaining}\``, inline: true },
          { name: '✔️ Đã gửi', value: `\`${used}\``, inline: true }
        )
        .setDescription(
          remaining < 10
            ? '⚠️ **Cảnh báo:** Số câu hỏi còn lại đang thấp, hãy import thêm!'
            : '📚 Kho câu hỏi đang ổn định.'
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      const errEmbed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('❌ Lỗi hệ thống')
        .setDescription('Không thể lấy thống kê, vui lòng thử lại sau.');
      await interaction.reply({ embeds: [errEmbed], ephemeral: true });
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
            { name: 'Daily Quiz',       value: 'quiz'      },
            { name: 'English Tip',      value: 'tip'       },
            { name: 'Tất cả',           value: 'all'       }
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