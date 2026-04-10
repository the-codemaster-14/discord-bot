const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  SlashCommandBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const MONTHLY_REMINDERS_CHANNEL_ID = process.env.MONTHLY_REMINDERS_CHANNEL_ID || '';
const BOOKINGS_TRACKER_CHANNEL_ID = process.env.BOOKINGS_TRACKER_CHANNEL_ID || '';
const TRENDING_ACCOUNT_WATCH_CHANNEL_ID = process.env.TRENDING_ACCOUNT_WATCH_CHANNEL_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function currentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function appendNote(existingNotes, newLine) {
  const existing = String(existingNotes || '').trim();
  const line = String(newLine || '').trim();

  if (!line) return existing;
  if (!existing) return line;
  return `${existing}\n${line}`;
}

function parseBookingDate(dateText) {
  const value = String(dateText || '').trim();
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
  }

  const normalized = value.replace(/-/g, ' ');
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function monthKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthKeyFromBookingDate(dateText) {
  const parsed = parseBookingDate(dateText);
  return parsed ? monthKeyFromDate(parsed) : null;
}

function getTorontoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);

  return { year, month, day };
}

function getFridayBeforeLastWeek(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const lastDayWeekday = lastDay.getUTCDay();
  const mondayOffset = (lastDayWeekday + 6) % 7;
  const mondayOfLastWeek = lastDay.getUTCDate() - mondayOffset;
  const target = new Date(Date.UTC(year, month - 1, mondayOfLastWeek - 3, 12));

  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate()
  };
}

function sameDateParts(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d;
}

function getPreviousWeekStart(date = new Date()) {
  const d = getWeekStart(date);
  d.setDate(d.getDate() - 7);
  return d;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function safeEngagementRate(likes, comments, views) {
  const l = Number(likes || 0);
  const c = Number(comments || 0);
  const v = Number(views || 0);

  if (v <= 0) return 0;
  return Number((((l + c) / v) * 100).toFixed(4));
}

function classifyTopic(text) {
  const normalized = normalizeText(text);

  const topicRules = [
    { topic: 'First-time buyers', keywords: ['first-time buyer', 'first time buyer', 'buying my first home', 'buy your first home', 'down payment', 'starter home', 'first home'] },
    { topic: 'Interest rates', keywords: ['interest rate', 'interest rates', 'mortgage rate', 'mortgage rates', 'bank of canada', 'rate cut', 'rate hold', 'variable rate', 'fixed rate'] },
    { topic: 'Market updates', keywords: ['market update', 'market crash', 'housing market', 'toronto market', 'gta market', 'inventory', 'benchmark price', 'average price', 'sales data'] },
    { topic: 'Home staging', keywords: ['staging', 'home staging', 'declutter', 'prepare your home', 'staged to sell'] },
    { topic: 'Seller tips', keywords: ['seller tip', 'selling your home', 'sell your home', 'listing prep', 'how to sell', 'seller mistakes'] },
    { topic: 'Buyer mistakes', keywords: ['buyer mistakes', 'mistakes buyers make', 'what buyers get wrong', 'buyers forget', 'buying mistake'] },
    { topic: 'Open house tips', keywords: ['open house', 'open houses', 'hosting an open house'] },
    { topic: 'Area guides', keywords: ['neighbourhood', 'neighborhood', 'living in', 'moving to', 'best area', 'best neighbourhood', 'area guide'] },
    { topic: 'Luxury listings', keywords: ['luxury listing', 'luxury real estate', 'luxury home', 'million dollar listing', 'waterfront estate'] },
    { topic: 'Condos vs houses', keywords: ['condo vs house', 'condo or house', 'condo vs freehold', 'freehold vs condo'] },
    { topic: 'Investing / rentals', keywords: ['investment property', 'rental property', 'cash flow', 'investor', 'real estate investing', 'landlord'] },
    { topic: 'Closing costs', keywords: ['closing costs', 'hidden costs', 'costs of buying', 'land transfer tax', 'legal fees', 'closing expenses'] },
    { topic: 'Mortgage tips', keywords: ['mortgage tip', 'mortgage approval', 'pre-approval', 'pre approval', 'amortization', 'stress test'] },
    { topic: 'Renovation / value add', keywords: ['renovation', 'before and after', 'value add', 'increase value', 'upgrade your home'] },
    { topic: 'Realtor behind-the-scenes', keywords: ['behind the scenes', 'day in the life', 'realtor life', 'showing day', 'listing day'] },
    { topic: 'Client testimonials', keywords: ['testimonial', 'happy client', 'client story', 'success story', 'just helped'] }
  ];

  for (const rule of topicRules) {
    if (rule.keywords.some(keyword => normalized.includes(keyword))) {
      return rule.topic;
    }
  }

  return 'Other';
}

function buildSuggestedIdeas(topics) {
  const topicToIdeas = {
    'First-time buyers': '3 first-time buyer mistakes people make in Toronto',
    'Interest rates': 'How interest rates actually change your monthly payment',
    'Market updates': 'Toronto market update: what changed this week',
    'Home staging': '3 staging fixes that make a home feel more expensive',
    'Seller tips': 'What sellers should do before listing this month',
    'Buyer mistakes': '5 mistakes buyers make before they even book a showing',
    'Open house tips': 'Nobody talks about this before hosting an open house',
    'Area guides': 'What it is really like living in this Toronto neighbourhood',
    'Luxury listings': 'What makes a luxury listing actually feel premium online',
    'Condos vs houses': 'Condo vs freehold in 2026: what actually matters',
    'Investing / rentals': 'What investors are missing in today’s rental market',
    'Closing costs': '5 hidden costs buyers forget in Toronto',
    'Mortgage tips': 'How to get mortgage-ready before you start house hunting',
    'Renovation / value add': '3 renovations that add value without over-improving',
    'Realtor behind-the-scenes': 'A real behind-the-scenes day of getting a listing live',
    'Client testimonials': 'What this buyer learned after finally closing on their first home',
    'Other': 'A fresh take on a topic competitors are starting to repeat'
  };

  return topics.slice(0, 3).map(topic => topicToIdeas[topic] || topicToIdeas.Other);
}

async function getAllClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getClientByEmail(email) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('email', normalizeText(email))
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function addClient({ name, phone, email, sessions_total, notes = '' }) {
  const { data, error } = await supabase
    .from('clients')
    .insert([{
      name,
      phone,
      email: normalizeText(email),
      sessions_used: 0,
      sessions_total,
      booked_this_month: 0,
      last_reset_month: currentMonthKey(),
      notes
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateClientByEmail(email, updates) {
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('email', normalizeText(email))
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getBotMeta(key) {
  const { data, error } = await supabase
    .from('bot_meta')
    .select('*')
    .eq('meta_key', key)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function setBotMeta(key, value) {
  const { error } = await supabase
    .from('bot_meta')
    .upsert([{
      meta_key: key,
      meta_value: value,
      updated_at: new Date().toISOString()
    }], { onConflict: 'meta_key' });

  if (error) throw error;
}

async function getScheduledBookingsByEmail(email) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_email', normalizeText(email))
    .eq('status', 'scheduled')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function findScheduledBookingByDateTime(email, bookingDate, bookingTime) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_email', normalizeText(email))
    .eq('booking_date', bookingDate)
    .eq('booking_time', bookingTime)
    .eq('status', 'scheduled')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data || [])[0] || null;
}

async function addBooking({ client_email, booking_date, booking_time }) {
  const bookingMonth = monthKeyFromBookingDate(booking_date);

  if (!bookingMonth) {
    throw new Error('Invalid booking date');
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      client_email: normalizeText(client_email),
      booking_date,
      booking_time,
      booking_month: bookingMonth,
      status: 'scheduled'
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function cancelLatestScheduledBooking(email) {
  const bookings = await getScheduledBookingsByEmail(email);
  const latest = bookings[0];

  if (!latest) {
    return null;
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', latest.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function cancelScheduledBooking(email, bookingDate, bookingTime) {
  const booking = await findScheduledBookingByDateTime(email, bookingDate, bookingTime);

  if (!booking) {
    return null;
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', booking.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function rescheduleScheduledBooking(email, oldDate, oldTime, newDate, newTime) {
  const booking = await findScheduledBookingByDateTime(email, oldDate, oldTime);

  if (!booking) {
    return null;
  }

  const newMonth = monthKeyFromBookingDate(newDate);
  if (!newMonth) {
    throw new Error('Invalid new booking date');
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      booking_date: newDate,
      booking_time: newTime,
      booking_month: newMonth,
      updated_at: new Date().toISOString()
    })
    .eq('id', booking.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function syncClientBookedThisMonth(email) {
  const normalizedEmail = normalizeText(email);
  const thisMonth = currentMonthKey();

  const { data, error } = await supabase
    .from('bookings')
    .select('status')
    .eq('client_email', normalizedEmail)
    .eq('booking_month', thisMonth)
    .in('status', ['scheduled', 'completed']);

  if (error) throw error;

  return updateClientByEmail(normalizedEmail, {
    booked_this_month: (data || []).length,
    last_reset_month: thisMonth
  });
}

async function resetMonthlyCountsIfNeeded() {
  const clients = await getAllClients();

  for (const c of clients) {
    await syncClientBookedThisMonth(c.email);
  }
}

async function sendMonthlyInactiveReminder() {
  if (!MONTHLY_REMINDERS_CHANNEL_ID) return false;

  const today = getTorontoDateParts();
  const target = getFridayBeforeLastWeek(today.year, today.month);

  if (!sameDateParts(today, target)) return false;

  const monthKey = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const alreadySent = await getBotMeta('monthly_inactive_reminder_last_sent');

  if (alreadySent?.meta_value === monthKey) return false;

  await resetMonthlyCountsIfNeeded();

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  const channel = await client.channels.fetch(MONTHLY_REMINDERS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  const preview = inactive.slice(0, 15).map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  const csv = buildCsv(inactive);
  const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), {
    name: `inactive-clients-${monthKey}.csv`
  });

  await channel.send({
    content: inactive.length === 0
      ? `Monthly reminder: everyone has booked for ${monthKey}.`
      : `Monthly reminder: ${inactive.length} client(s) have not booked for ${monthKey}.\nAttached: full CSV.\n\nShowing first ${Math.min(inactive.length, 15)}:\n${preview}`,
    files: [attachment]
  });

  await setBotMeta('monthly_inactive_reminder_last_sent', monthKey);
  return true;
}

async function forceSendMonthlyInactiveReminder() {
  if (!MONTHLY_REMINDERS_CHANNEL_ID) return false;

  await resetMonthlyCountsIfNeeded();

  const today = getTorontoDateParts();
  const monthKey = `${today.year}-${String(today.month).padStart(2, '0')}`;

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  const channel = await client.channels.fetch(MONTHLY_REMINDERS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  const preview = inactive.slice(0, 15).map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  const csv = buildCsv(inactive);
  const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), {
    name: `inactive-clients-${monthKey}.csv`
  });

  await channel.send({
    content: inactive.length === 0
      ? `Manual monthly reminder test: everyone has booked for ${monthKey}.`
      : `Manual monthly reminder test: ${inactive.length} client(s) have not booked for ${monthKey}.\nAttached: full CSV.\n\nShowing first ${Math.min(inactive.length, 15)}:\n${preview}`,
    files: [attachment]
  });

  return true;
}

async function sendBookingTrackerMessage(content) {
  if (!BOOKINGS_TRACKER_CHANNEL_ID) return false;

  const channel = await client.channels.fetch(BOOKINGS_TRACKER_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  await channel.send({ content });
  return true;
}

async function sendTrendingAccountWatchMessage(content) {
  if (!TRENDING_ACCOUNT_WATCH_CHANNEL_ID) return false;

  const channel = await client.channels.fetch(TRENDING_ACCOUNT_WATCH_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  await channel.send({ content });
  return true;
}

async function getTrackedAccounts(tier = null) {
  let query = supabase
    .from('tracked_accounts')
    .select('*')
    .eq('is_active', true)
    .order('tier', { ascending: true })
    .order('name', { ascending: true });

  if (tier) {
    query = query.eq('tier', tier);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getTrackedAccountByUsername(username) {
  const { data, error } = await supabase
    .from('tracked_accounts')
    .select('*')
    .eq('username', normalizeText(username).replace(/^@/, ''))
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function addContentPost({
  account_id,
  account_name,
  platform = 'instagram',
  post_date,
  caption,
  hook,
  hashtags = [],
  topic,
  likes = 0,
  comments = 0,
  views = 0,
  engagement_rate = 0,
  url = ''
}) {
  const { data, error } = await supabase
    .from('content_posts')
    .insert([{
      account_id,
      account_name,
      platform,
      post_date,
      caption,
      hook,
      hashtags,
      topic,
      likes,
      comments,
      views,
      engagement_rate,
      url
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getContentPostsBetween(startDate, endDate) {
  const { data, error } = await supabase
    .from('content_posts')
    .select('*')
    .gte('post_date', startDate.toISOString())
    .lt('post_date', endDate.toISOString())
    .order('post_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

function summarizeTopicStats(posts) {
  const stats = new Map();

  for (const post of posts) {
    const topic = post.topic || 'Other';
    const current = stats.get(topic) || { topic, count: 0, totalEngagement: 0 };
    current.count += 1;
    current.totalEngagement += Number(post.engagement_rate || 0);
    stats.set(topic, current);
  }

  return Array.from(stats.values()).map(item => ({
    topic: item.topic,
    count: item.count,
    avgEngagement: item.count > 0 ? item.totalEngagement / item.count : 0
  }));
}

function computeGrowingTopics(currentStats, previousStats) {
  const prevMap = new Map(previousStats.map(item => [item.topic, item.count]));

  return currentStats.map(item => {
    const previousCount = prevMap.get(item.topic) || 0;
    const changePercent = previousCount === 0
      ? (item.count > 0 ? 100 : 0)
      : ((item.count - previousCount) / previousCount) * 100;

    return { ...item, changePercent };
  });
}

function formatClientLine(c) {
  const remaining = c.sessions_total - c.sessions_used;
  return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining} | This month: ${c.booked_this_month}`;
}

function formatClientDetails(c) {
  const remaining = c.sessions_total - c.sessions_used;
  return `${c.name}
Phone: ${c.phone || ''}
Email: ${c.email}
Sessions Used: ${c.sessions_used}/${c.sessions_total}
Sessions Remaining: ${remaining}
Booked This Month: ${c.booked_this_month}
Notes: ${c.notes || 'None'}`;
}

function escapeCsvValue(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(clients) {
  const fields = [
    'name',
    'phone',
    'email',
    'sessions_used',
    'sessions_total',
    'booked_this_month',
    'last_reset_month',
    'notes'
  ];

  const rows = clients.map(c => [
    c.name,
    c.phone || '',
    c.email,
    c.sessions_used,
    c.sessions_total,
    c.booked_this_month,
    c.last_reset_month || '',
    c.notes || ''
  ]);

  return [
    fields.join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ].join('\n');
}

async function replyText(target, content) {
  if ('author' in target) {
    return target.channel.send({ content });
  }

  if (target.replied || target.deferred) {
    return target.followUp({ content });
  }

  return target.reply({ content });
}

async function handleListClients(target, limit = 20, page = 1) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const clients = await getAllClients();

  if (clients.length === 0) return replyText(target, 'No clients yet.');

  const start = (safePage - 1) * safeLimit;
  const pageClients = clients.slice(start, start + safeLimit);

  if (pageClients.length === 0) return replyText(target, 'No clients on that page.');

  return replyText(
    target,
    `Showing ${pageClients.length} of ${clients.length} clients (page ${safePage}):\n${pageClients.map(formatClientLine).join('\n')}`
  );
}

async function handleSearchClient(target, query) {
  const normalized = normalizeText(query);
  if (!normalized) return replyText(target, 'Usage: !searchclient name or email');

  const clients = await getAllClients();
  const matches = clients.filter(c =>
    (c.name && c.name.toLowerCase().includes(normalized)) ||
    (c.email && c.email.toLowerCase().includes(normalized)) ||
    (c.phone && c.phone.toLowerCase().includes(normalized))
  );

  if (matches.length === 0) return replyText(target, 'No matching clients found.');

  const limited = matches.slice(0, 20);
  return replyText(
    target,
    `Found ${matches.length} matching client(s). Showing ${limited.length}:\n${limited.map(formatClientLine).join('\n')}`
  );
}

async function handleClient(target, query) {
  const normalized = normalizeText(query);
  if (!normalized) return replyText(target, 'Usage: !client email@example.com or !client partial name');

  const exact = await getClientByEmail(normalized);
  if (exact) return replyText(target, formatClientDetails(exact));

  const clients = await getAllClients();
  const matches = clients.filter(c =>
    (c.name && c.name.toLowerCase().includes(normalized)) ||
    (c.email && c.email.toLowerCase().includes(normalized)) ||
    (c.phone && c.phone.toLowerCase().includes(normalized))
  );

  if (matches.length === 0) return replyText(target, 'Client not found.');
  if (matches.length === 1) return replyText(target, formatClientDetails(matches[0]));

  const limited = matches.slice(0, 10);
  return replyText(
    target,
    `Found ${matches.length} matching clients. Be more specific or use the exact email.\nShowing ${limited.length}:\n${limited.map(formatClientLine).join('\n')}`
  );
}

async function handleInactiveClients(target, limit = 20, page = 1) {
  await resetMonthlyCountsIfNeeded();

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  if (inactive.length === 0) return replyText(target, 'Everyone has booked this month.');

  const start = (safePage - 1) * safeLimit;
  const pageClients = inactive.slice(start, start + safeLimit);

  if (pageClients.length === 0) return replyText(target, 'No inactive clients on that page.');

  const text = pageClients.map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  return replyText(
    target,
    `Showing ${pageClients.length} of ${inactive.length} clients with no bookings this month (page ${safePage}):\n${text}`
  );
}

async function handleRenewals(target, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const clients = await getAllClients();
  const renewalClients = clients.filter(c => c.sessions_used >= c.sessions_total - 1);

  if (renewalClients.length === 0) return replyText(target, 'No clients currently need renewal attention.');

  const limited = renewalClients.slice(0, safeLimit);
  return replyText(
    target,
    `Showing ${limited.length} of ${renewalClients.length} clients needing renewal attention:\n${limited.map(formatClientLine).join('\n')}`
  );
}

async function handleAddClient(target, name, phone, email, totalSessions = 6, notes = '') {
  const normalizedEmail = normalizeText(email);
  const total = Number(totalSessions || 6);

  if (!name || !phone || !normalizedEmail || Number.isNaN(total)) {
    return replyText(target, 'Usage: !addclient Name phone email@example.com totalSessions [notes]');
  }

  const existing = await getClientByEmail(normalizedEmail);
  if (existing) return replyText(target, 'Client already exists.');

  const added = await addClient({
    name,
    phone,
    email: normalizedEmail,
    sessions_total: total,
    notes
  });

  return replyText(target, `Added ${added.name}`);
}

async function handleBook(target, email, bookingDate, bookingTime) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail || !bookingDate || !bookingTime) {
    return replyText(target, 'Usage: !book email@example.com April-18-2026 1:00PM');
  }

  if (!monthKeyFromBookingDate(bookingDate)) {
    return replyText(target, 'Invalid booking date. Use something like 2026-05-15, 5/15/2026, or April-18-2026.');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  if (c.sessions_used >= c.sessions_total) {
    return replyText(
      target,
      `Booking blocked.\n${c.name} is already at ${c.sessions_used}/${c.sessions_total}. Renew them first if needed.`
    );
  }

  await updateClientByEmail(normalizedEmail, {
    sessions_used: c.sessions_used + 1,
    notes: appendNote(c.notes, `Booked: ${bookingDate} ${bookingTime}`)
  });

  await addBooking({
    client_email: normalizedEmail,
    booking_date: bookingDate,
    booking_time: bookingTime
  });

  const updated = await syncClientBookedThisMonth(normalizedEmail);
  await sendBookingTrackerMessage(
    `Booking scheduled: ${updated.name} (${updated.email}) booked ${bookingDate} at ${bookingTime}.`
  );

  const sessionsRemaining = updated.sessions_total - updated.sessions_used;

  return replyText(
    target,
    `${updated.name} has booked for ${bookingDate} at ${bookingTime}.
Sessions remaining: ${sessionsRemaining}

Email: ${updated.email}
Phone: ${updated.phone || ''}
Booked this month: ${updated.booked_this_month}
Notes: ${updated.notes || 'None'}`
  );
}

async function handleCancelBooking(target, email, bookingDate, bookingTime, reason = '') {
  const normalizedEmail = normalizeText(email);
  const cleanReason = String(reason || '').trim();

  if (!normalizedEmail || !bookingDate || !bookingTime) {
    return replyText(target, 'Usage: !cancelbooking email@example.com April-18-2026 1:00PM [reason]');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const cancelled = await cancelScheduledBooking(normalizedEmail, bookingDate, bookingTime);
  if (!cancelled) {
    return replyText(target, 'No matching scheduled booking was found for that client/date/time.');
  }

  const noteLine = cleanReason
    ? `Cancelled: ${bookingDate} ${bookingTime} | Reason: ${cleanReason}`
    : `Cancelled: ${bookingDate} ${bookingTime}`;

  await updateClientByEmail(normalizedEmail, {
    sessions_used: Math.max(0, c.sessions_used - 1),
    notes: appendNote(c.notes, noteLine)
  });

  const updated = await syncClientBookedThisMonth(normalizedEmail);

  await sendBookingTrackerMessage(
    cleanReason
      ? `Booking cancelled: ${updated.name} (${updated.email}) cancelled ${bookingDate} at ${bookingTime}. Reason: ${cleanReason}`
      : `Booking cancelled: ${updated.name} (${updated.email}) cancelled ${bookingDate} at ${bookingTime}.`
  );

  return replyText(
    target,
    `Cancelled booking for ${updated.name}.
Sessions now used: ${updated.sessions_used}/${updated.sessions_total}
Booked this month: ${updated.booked_this_month}`
  );
}

async function handleRescheduleBooking(target, email, oldDate, oldTime, newDate, newTime) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail || !oldDate || !oldTime || !newDate || !newTime) {
    return replyText(target, 'Usage: !reschedulebooking email@example.com oldDate oldTime newDate newTime');
  }

  if (!monthKeyFromBookingDate(newDate)) {
    return replyText(target, 'Invalid new booking date. Use something like 2026-05-15, 5/15/2026, or April-18-2026.');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const moved = await rescheduleScheduledBooking(normalizedEmail, oldDate, oldTime, newDate, newTime);
  if (!moved) {
    return replyText(target, 'No matching scheduled booking was found for that client/date/time.');
  }

  await updateClientByEmail(normalizedEmail, {
    notes: appendNote(c.notes, `Rescheduled: ${oldDate} ${oldTime} -> ${newDate} ${newTime}`)
  });

  const updated = await syncClientBookedThisMonth(normalizedEmail);

  await sendBookingTrackerMessage(
    `Booking rescheduled: ${updated.name} (${updated.email}) moved from ${oldDate} at ${oldTime} to ${newDate} at ${newTime}.`
  );

  return replyText(
    target,
    `Rescheduled booking for ${updated.name} from ${oldDate} ${oldTime} to ${newDate} ${newTime}.
Booked this month: ${updated.booked_this_month}`
  );
}

async function handleUndoSession(target, email) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail) return replyText(target, 'Usage: !undosession email@example.com');

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const cancelled = await cancelLatestScheduledBooking(normalizedEmail);
  if (!cancelled) {
    return replyText(target, 'No scheduled booking was found to undo.');
  }

  await updateClientByEmail(normalizedEmail, {
    sessions_used: Math.max(0, c.sessions_used - 1)
  });

  const updated = await syncClientBookedThisMonth(normalizedEmail);
  return replyText(target, `Removed one booking/session from ${updated.name}`);
}

async function handleSetPhone(target, email, phone) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail || !phone) {
    return replyText(target, 'Usage: !setphone email@example.com 416-555-1234');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  await updateClientByEmail(normalizedEmail, { phone });
  return replyText(target, `Updated phone for ${c.name}`);
}

async function handleSetUsed(target, email, used) {
  const normalizedEmail = normalizeText(email);
  const numericUsed = Number(used);

  if (!normalizedEmail || Number.isNaN(numericUsed)) {
    return replyText(target, 'Usage: !setused email@example.com 1');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: Math.max(0, numericUsed)
  });

  return replyText(target, `Updated ${updated.name} to ${updated.sessions_used}/${updated.sessions_total}`);
}

async function handleSetBookedMonth(target, email) {
  const normalizedEmail = normalizeText(email);

  if (!normalizedEmail) {
    return replyText(target, 'Usage: !setbookedmonth email@example.com');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const updated = await syncClientBookedThisMonth(normalizedEmail);
  return replyText(target, `Recalculated ${updated.name} booked_this_month to ${updated.booked_this_month}`);
}

async function handleSetTotal(target, email, total) {
  const normalizedEmail = normalizeText(email);
  const numericTotal = Number(total);

  if (!normalizedEmail || Number.isNaN(numericTotal)) {
    return replyText(target, 'Usage: !settotal email@example.com 6');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_total: numericTotal
  });

  return replyText(target, `Updated total sessions for ${updated.name} to ${numericTotal}`);
}

async function handleRenewClient(target, email, total = 6) {
  const normalizedEmail = normalizeText(email);
  const numericTotal = Number(total || 6);

  if (!normalizedEmail || Number.isNaN(numericTotal)) {
    return replyText(target, 'Usage: !renewclient email@example.com 6');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: 0,
    sessions_total: numericTotal,
    last_reset_month: currentMonthKey()
  });

  await syncClientBookedThisMonth(normalizedEmail);

  return replyText(target, `Renewed ${updated.name}. Sessions reset to 0/${updated.sessions_total}.`);
}

async function handleSetNote(target, email, note) {
  const normalizedEmail = normalizeText(email);
  const noteText = String(note || '').trim();

  if (!normalizedEmail || !noteText) {
    return replyText(target, 'Usage: !setnote email@example.com your note here');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const updated = await updateClientByEmail(normalizedEmail, {
    notes: noteText
  });

  return replyText(target, `Updated notes for ${updated.name}`);
}

async function handleNote(target, email) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail) return replyText(target, 'Usage: !note email@example.com');

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  return replyText(target, `${c.name}\nNotes: ${c.notes || 'None'}`);
}

async function handleExportCsv(target) {
  const clients = await getAllClients();
  if (clients.length === 0) return replyText(target, 'No clients to export.');

  const csv = buildCsv(clients);
  const attachment = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), { name: 'clients.csv' });

  if ('author' in target) {
    return target.reply({ content: 'Client export:', files: [attachment] });
  }

  if (target.replied || target.deferred) {
    return target.followUp({ content: 'Client export:', files: [attachment] });
  }

  return target.reply({ content: 'Client export:', files: [attachment] });
}

async function handleRemoveClient(target, email, confirmWord) {
  const normalizedEmail = normalizeText(email);

  if (!normalizedEmail || String(confirmWord || '').toLowerCase() !== 'confirm') {
    return replyText(target, 'Usage: !removeclient email@example.com confirm');
  }

  const c = await getClientByEmail(normalizedEmail);
  if (!c) return replyText(target, 'Client not found.');

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('email', normalizedEmail);

  if (error) throw error;
  return replyText(target, `Removed ${normalizedEmail}`);
}

async function handleResetMonth(target, confirmWord) {
  if (String(confirmWord || '').toLowerCase() !== 'confirm') {
    return replyText(target, 'Usage: !resetmonth confirm');
  }

  await resetMonthlyCountsIfNeeded();
  return replyText(target, 'Monthly booking counts synchronized from scheduled bookings.');
}

async function handleTrackedAccounts(target, tier = '') {
  const requestedTier = String(tier || '').trim();
  const normalizedTier = requestedTier ? requestedTier.replace(/^tier\s*/i, '').toUpperCase() : '';
  const tierValue = normalizedTier ? `Tier ${normalizedTier}` : null;

  const accounts = await getTrackedAccounts(tierValue);

  if (accounts.length === 0) {
    return replyText(target, 'No tracked accounts found for that tier.');
  }

  const lines = accounts.map(a => {
    const handle = a.username ? `@${a.username}` : '(no username)';

    let tagsText = 'None';
    if (Array.isArray(a.tags)) {
      tagsText = a.tags.join(', ');
    } else if (typeof a.tags === 'string') {
      tagsText = a.tags;
    } else if (a.tags && typeof a.tags === 'object') {
      tagsText = Object.values(a.tags).join(', ');
    }

    return `${a.tier} | ${a.name} | ${handle} | Tags: ${tagsText}`;
  });

  return replyText(target, lines.join('\n'));
}

async function handleClassifyTopic(target, text) {
  const input = String(text || '').trim();
  if (!input) return replyText(target, 'Usage: !classifytopic your caption text here');

  return replyText(target, `Detected topic: ${classifyTopic(input)}`);
}

async function handleAddTrendPost(target, username, postDate, likes, comments, views, url, caption) {
  const cleanUsername = normalizeText(username).replace(/^@/, '');
  const cleanCaption = String(caption || '').trim();

  if (!cleanUsername || !postDate || !url || !cleanCaption) {
    return replyText(
      target,
      'Usage: !addtrendpost username YYYY-MM-DD likes comments views https://post-url caption text here'
    );
  }

  const account = await getTrackedAccountByUsername(cleanUsername);
  if (!account) return replyText(target, `Tracked account not found for @${cleanUsername}`);

  const numericLikes = Number(likes || 0);
  const numericComments = Number(comments || 0);
  const numericViews = Number(views || 0);

  if ([numericLikes, numericComments, numericViews].some(Number.isNaN)) {
    return replyText(target, 'Likes, comments, and views must be numbers.');
  }

  const topic = classifyTopic(cleanCaption);
  const hashtags = (cleanCaption.match(/#[a-zA-Z0-9_]+/g) || []).map(tag => tag.toLowerCase());
  const hook = cleanCaption.split('\n')[0].trim().slice(0, 200);
  const engagementRate = safeEngagementRate(numericLikes, numericComments, numericViews);
  const isoPostDate = new Date(`${postDate}T12:00:00.000Z`);

  if (Number.isNaN(isoPostDate.getTime())) {
    return replyText(target, 'Post date must be in YYYY-MM-DD format.');
  }

  const created = await addContentPost({
    account_id: account.id,
    account_name: account.name,
    platform: account.platform || 'instagram',
    post_date: isoPostDate.toISOString(),
    caption: cleanCaption,
    hook,
    hashtags,
    topic,
    likes: numericLikes,
    comments: numericComments,
    views: numericViews,
    engagement_rate: engagementRate,
    url
  });

  await sendTrendingAccountWatchMessage(
    `New trend post added:
Account: ${created.account_name}
Topic: ${created.topic}
Date: ${postDate}
Engagement: ${formatPercent(created.engagement_rate)}`
  );

  return replyText(target, 'Trend post saved and posted to #trending-account-watch.');
}

async function handleTrendTopics(target, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const weekStart = getWeekStart();
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const posts = await getContentPostsBetween(weekStart, nextWeek);
  if (posts.length === 0) return replyText(target, 'No trend posts found for this week yet.');

  const stats = summarizeTopicStats(posts)
    .sort((a, b) => b.count - a.count)
    .slice(0, safeLimit);

  const output = `Topic frequency for week starting ${toIsoDate(weekStart)}:
${stats.map((item, index) =>
  `${index + 1}. ${item.topic} - ${item.count} post(s) | Avg engagement ${formatPercent(item.avgEngagement)}`
).join('\n')}`;

  await sendTrendingAccountWatchMessage(output);
  return replyText(target, 'Topic report posted to #trending-account-watch.');
}

async function handleTrendsWeekly(target) {
  const weekStart = getWeekStart();
  const prevWeekStart = getPreviousWeekStart();
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const currentPosts = await getContentPostsBetween(weekStart, nextWeek);
  const previousPosts = await getContentPostsBetween(prevWeekStart, weekStart);

  if (currentPosts.length === 0) return replyText(target, 'No trend posts found for this week yet.');

  const currentStats = summarizeTopicStats(currentPosts);
  const previousStats = summarizeTopicStats(previousPosts);

  const mostFrequent = [...currentStats].sort((a, b) => b.count - a.count).slice(0, 5);
  const fastestGrowing = computeGrowingTopics(currentStats, previousStats)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 3);
  const bestPerforming = [...currentStats].sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 3);
  const ideas = buildSuggestedIdeas(mostFrequent.map(item => item.topic));

  const message = [
    'Weekly Real Estate Topic Tracker',
    `Week starting: ${toIsoDate(weekStart)}`,
    '',
    'Most Frequent Topics:',
    ...mostFrequent.map((item, index) => `${index + 1}. ${item.topic} - ${item.count} posts`),
    '',
    'Fastest Growing Topics:',
    ...fastestGrowing.map((item, index) => `${index + 1}. ${item.topic} - ${formatPercent(item.changePercent)} growth`),
    '',
    'Best Performing Topics:',
    ...bestPerforming.map((item, index) => `${index + 1}. ${item.topic} - Avg ${formatPercent(item.avgEngagement)} engagement`),
    '',
    'Suggested Content Ideas:',
    ...ideas.map((idea, index) => `${index + 1}. ${idea}`)
  ].join('\n');

  await sendTrendingAccountWatchMessage(message);
  return replyText(target, 'Weekly trend report posted to #trending-account-watch.');
}

async function handleTrendIdeas(target) {
  const weekStart = getWeekStart();
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const posts = await getContentPostsBetween(weekStart, nextWeek);
  if (posts.length === 0) return replyText(target, 'No trend posts found for this week yet.');

  const topTopics = summarizeTopicStats(posts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(item => item.topic);

  const ideas = buildSuggestedIdeas(topTopics);
  const output = `Content ideas based on current tracker data:
${ideas.map((idea, index) => `${index + 1}. ${idea}`).join('\n')}`;

  await sendTrendingAccountWatchMessage(output);
  return replyText(target, 'Content ideas posted to #trending-account-watch.');
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName('client')
    .setDescription('Show one client by exact email or partial name')
    .addStringOption(o => o.setName('query').setDescription('Email, name, or phone').setRequired(true)),

  new SlashCommandBuilder()
    .setName('searchclient')
    .setDescription('Search clients by name, email, or phone')
    .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listclients')
    .setDescription('List clients with pagination')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show'))
    .addIntegerOption(o => o.setName('page').setDescription('Page number')),

  new SlashCommandBuilder()
    .setName('inactiveclients')
    .setDescription('Show clients with no bookings this month')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show'))
    .addIntegerOption(o => o.setName('page').setDescription('Page number')),

  new SlashCommandBuilder()
    .setName('renewals')
    .setDescription('Show clients needing renewal attention')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show')),

  new SlashCommandBuilder()
    .setName('addclient')
    .setDescription('Add a new client')
    .addStringOption(o => o.setName('name').setDescription('Client name').setRequired(true))
    .addStringOption(o => o.setName('phone').setDescription('Phone number').setRequired(true))
    .addStringOption(o => o.setName('email').setDescription('Email').setRequired(true))
    .addIntegerOption(o => o.setName('total_sessions').setDescription('Total sessions'))
    .addStringOption(o => o.setName('notes').setDescription('Optional notes')),

  new SlashCommandBuilder()
    .setName('renewclient')
    .setDescription('Renew a client and reset usage')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('total').setDescription('New total sessions')),

  new SlashCommandBuilder()
    .setName('setused')
    .setDescription('Set used sessions exactly')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('used').setDescription('Used sessions').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setbookedmonth')
    .setDescription('Recalculate booked_this_month from scheduled bookings')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settotal')
    .setDescription('Set total sessions exactly')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('total').setDescription('Total sessions').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setnote')
    .setDescription('Set client notes')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('New note').setRequired(true)),

  new SlashCommandBuilder()
    .setName('exportcsv')
    .setDescription('Export all clients as CSV'),

  new SlashCommandBuilder()
    .setName('cancelbooking')
    .setDescription('Cancel a booking and notify the bookings tracker')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addStringOption(o => o.setName('date').setDescription('Original booking date').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('Original booking time').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Optional reason')),

  new SlashCommandBuilder()
    .setName('reschedulebooking')
    .setDescription('Reschedule a booking and notify the bookings tracker')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addStringOption(o => o.setName('old_date').setDescription('Old date').setRequired(true))
    .addStringOption(o => o.setName('old_time').setDescription('Old time').setRequired(true))
    .addStringOption(o => o.setName('new_date').setDescription('New date').setRequired(true))
    .addStringOption(o => o.setName('new_time').setDescription('New time').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trackedaccounts')
    .setDescription('Show tracked trend accounts')
    .addStringOption(o => o.setName('tier').setDescription('Optional tier like A, B, C, or D')),

  new SlashCommandBuilder()
    .setName('classifytopic')
    .setDescription('Classify a piece of content into a topic')
    .addStringOption(o => o.setName('text').setDescription('Caption or hook text').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trendstopics')
    .setDescription('Show top topics for this week')
    .addIntegerOption(o => o.setName('limit').setDescription('How many topics to show')),

  new SlashCommandBuilder()
    .setName('trendsweekly')
    .setDescription('Show the weekly topic tracker summary'),

  new SlashCommandBuilder()
    .setName('trendideas')
    .setDescription('Generate content ideas from current trend data')
].map(c => c.toJSON());

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await sendMonthlyInactiveReminder();
    await client.application.commands.set(slashCommands);
    console.log('Slash commands registered');
  } catch (error) {
    console.error('Startup error:', error);
  }
});

setInterval(async () => {
  try {
    await resetMonthlyCountsIfNeeded();
    await sendMonthlyInactiveReminder();
  } catch (error) {
    console.error('Monthly scheduled task error:', error);
  }
}, 60 * 60 * 1000);

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.trim().startsWith('!')) return;

  try {
    await resetMonthlyCountsIfNeeded();

    const args = message.content.trim().split(' ');
    const command = args[0]?.toLowerCase();

    if (command === '!monthlyreminder' || command === '!forcesendmonthlyreminder') {
      const sent = await forceSendMonthlyInactiveReminder();

      if (!sent) {
        return message.reply('Could not send monthly reminder. Check MONTHLY_REMINDERS_CHANNEL_ID.');
      }

      return message.reply('Monthly reminder sent to the monthly reminders channel.');
    }

    if (command === '!helpbot') {
      return message.reply(
`Client commands:
!addclient Name phone email@example.com totalSessions [notes]
!listclients
!listclients 10
!listclients 10 2
!searchclient query
!client query
!inactiveclients
!inactiveclients 20 2
!renewals
!book email@example.com April-18-2026 1:00PM
!cancelbooking email@example.com April-18-2026 1:00PM [reason]
!reschedulebooking email@example.com April-18-2026 1:00PM April-25-2026 2:00PM
!undosession email@example.com
!setphone email@example.com 416-555-1234
!setused email@example.com 1
!setbookedmonth email@example.com
!setsessions email@example.com 6
!settotal email@example.com 6
!renewclient email@example.com 6
!setnote email@example.com your note here
!note email@example.com
!exportcsv
!monthlyreminder
!forcesendmonthlyreminder
!removeclient email@example.com confirm
!resetmonth confirm

Trend commands:
!trackedaccounts
!trackedaccounts B
!classifytopic caption text here
!addtrendpost username YYYY-MM-DD likes comments views https://url caption text here
!trendstopics
!trendsweekly
!trendideas`
      );
    }

    if (command === '!addclient') return handleAddClient(message, args[1], args[2], args[3], args[4], args.slice(5).join(' '));
    if (command === '!listclients') return handleListClients(message, args[1], args[2]);
    if (command === '!searchclient') return handleSearchClient(message, args.slice(1).join(' '));
    if (command === '!client') return handleClient(message, args.slice(1).join(' '));
    if (command === '!inactiveclients') return handleInactiveClients(message, args[1], args[2]);
    if (command === '!renewals') return handleRenewals(message, args[1]);
    if (command === '!book') return handleBook(message, args[1], args[2], args[3]);
    if (command === '!cancelbooking') return handleCancelBooking(message, args[1], args[2], args[3], args.slice(4).join(' '));
    if (command === '!reschedulebooking') return handleRescheduleBooking(message, args[1], args[2], args[3], args[4], args[5]);
    if (command === '!undosession') return handleUndoSession(message, args[1]);
    if (command === '!setphone') return handleSetPhone(message, args[1], args[2]);
    if (command === '!setused') return handleSetUsed(message, args[1], args[2]);
    if (command === '!setbookedmonth') return handleSetBookedMonth(message, args[1]);
    if (command === '!setsessions' || command === '!settotal') return handleSetTotal(message, args[1], args[2]);
    if (command === '!renewclient') return handleRenewClient(message, args[1], args[2]);
    if (command === '!setnote') return handleSetNote(message, args[1], args.slice(2).join(' '));
    if (command === '!note') return handleNote(message, args[1]);
    if (command === '!exportcsv') return handleExportCsv(message);
    if (command === '!removeclient') return handleRemoveClient(message, args[1], args[2]);
    if (command === '!resetmonth') return handleResetMonth(message, args[1]);
    if (command === '!trackedaccounts') return handleTrackedAccounts(message, args[1] || '');
    if (command === '!classifytopic') return handleClassifyTopic(message, args.slice(1).join(' '));
    if (command === '!addtrendpost') return handleAddTrendPost(message, args[1], args[2], args[3], args[4], args[5], args[6], args.slice(7).join(' '));
    if (command === '!trendstopics') return handleTrendTopics(message, args[1]);
    if (command === '!trendsweekly') return handleTrendsWeekly(message);
    if (command === '!trendideas') return handleTrendIdeas(message);
  } catch (error) {
    console.error(error);
    return message.channel.send({ content: 'Something went wrong.' });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === 'client') {
      return handleClient(interaction, interaction.options.getString('query', true));
    }

    if (interaction.commandName === 'searchclient') {
      return handleSearchClient(interaction, interaction.options.getString('query', true));
    }

    if (interaction.commandName === 'listclients') {
      return handleListClients(
        interaction,
        interaction.options.getInteger('limit') || 20,
        interaction.options.getInteger('page') || 1
      );
    }

    if (interaction.commandName === 'inactiveclients') {
      return handleInactiveClients(
        interaction,
        interaction.options.getInteger('limit') || 20,
        interaction.options.getInteger('page') || 1
      );
    }

    if (interaction.commandName === 'renewals') {
      return handleRenewals(interaction, interaction.options.getInteger('limit') || 20);
    }

    if (interaction.commandName === 'addclient') {
      return handleAddClient(
        interaction,
        interaction.options.getString('name', true),
        interaction.options.getString('phone', true),
        interaction.options.getString('email', true),
        interaction.options.getInteger('total_sessions') || 6,
        interaction.options.getString('notes') || ''
      );
    }

    if (interaction.commandName === 'renewclient') {
      return handleRenewClient(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('total') || 6
      );
    }

    if (interaction.commandName === 'setused') {
      return handleSetUsed(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('used', true)
      );
    }

    if (interaction.commandName === 'setbookedmonth') {
      return handleSetBookedMonth(
        interaction,
        interaction.options.getString('email', true)
      );
    }

    if (interaction.commandName === 'settotal') {
      return handleSetTotal(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('total', true)
      );
    }

    if (interaction.commandName === 'setnote') {
      return handleSetNote(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getString('note', true)
      );
    }

    if (interaction.commandName === 'exportcsv') {
      return handleExportCsv(interaction);
    }

    if (interaction.commandName === 'cancelbooking') {
      return handleCancelBooking(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getString('date', true),
        interaction.options.getString('time', true),
        interaction.options.getString('reason') || ''
      );
    }

    if (interaction.commandName === 'reschedulebooking') {
      return handleRescheduleBooking(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getString('old_date', true),
        interaction.options.getString('old_time', true),
        interaction.options.getString('new_date', true),
        interaction.options.getString('new_time', true)
      );
    }

    if (interaction.commandName === 'trackedaccounts') {
      return handleTrackedAccounts(interaction, interaction.options.getString('tier') || '');
    }

    if (interaction.commandName === 'classifytopic') {
      return handleClassifyTopic(interaction, interaction.options.getString('text', true));
    }

    if (interaction.commandName === 'trendstopics') {
      return handleTrendTopics(interaction, interaction.options.getInteger('limit') || 10);
    }

    if (interaction.commandName === 'trendsweekly') {
      return handleTrendsWeekly(interaction);
    }

    if (interaction.commandName === 'trendideas') {
      return handleTrendIdeas(interaction);
    }
  } catch (error) {
    console.error(error);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: 'Something went wrong.',
        ephemeral: true
      });
    }
  }
});

client.login(BOT_TOKEN);
