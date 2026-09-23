const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, REST, Routes } = require('discord.js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const config = require('./config.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildBans]
});

let db = { points: {}, xp: {}, tickets: {}, ticketsData: {}, logins: [], actions: [], panelImage: null, subUrls: {}, promoPoints: 50 };
if (fs.existsSync('./db.json')) {
  try { db = JSON.parse(fs.readFileSync('./db.json')); } catch {}
}
if (!db.points) db.points = {};
if (!db.xp) db.xp = {};
if (!db.tickets) db.tickets = {};
if (!db.ticketsData) db.ticketsData = {};
if (!db.logins) db.logins = [];
if (!db.promoPoints) db.promoPoints = 50;
const save = () => { fs.writeFileSync('./db.json', JSON.stringify(db, null, 2)); };

async function autoPromote(member) {
  try {
    const points = db.points[member.id] || 0;
    const needed = db.promoPoints || 50;
    if (points < needed) return;
    const guild = member.guild;
    const allRoles = [...guild.roles.cache.filter(r =>!r.managed && r.id!== guild.id).sort((a, b) => b.position - a.position).values()];
    const memberRoles = [...member.roles.cache.filter(r =>!r.managed && r.id!== guild.id).sort((a, b) => b.position - a.position).values()];
    if (!memberRoles.length) return;
    const currentHighest = memberRoles[0];
    const currentIndex = allRoles.findIndex(r => r.id === currentHighest.id);
    const nextRole = allRoles[currentIndex - 1];
    if (!nextRole) return;
    await member.roles.remove(currentHighest.id).catch(()=>{});
    await member.roles.add(nextRole.id).catch(()=>{});
    db.points[member.id] = 0;
    save();
    const logCh = client.channels.cache.get(config.logsChannelId);
    if (logCh) {
      logCh.send({ embeds: [new EmbedBuilder().setTitle('🎉 ترقية تلقائية').setDescription(`${member} ترقى من <@&${currentHighest.id}> الى <@&${nextRole.id}>`).setColor('Gold').setFooter({text: config.footer})] });
    }
  } catch(e) { console.log('Promote error', e.message); }
}

const app = express();
app.use(express.json());
app.use(session({ secret: 'support-2026-secret', resave: false, saveUninitialized: false }));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); next(); });

app.get('/', (req,res) => {
  res.send(`<html><head><meta charset="UTF-8"><title>Bot Online</title></head><body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#0f0f0f;color:#fff"><h1>Support Social Media Bot Online ✅</h1><h2>${config.footer}</h2><a href="/dashboard" style="background:red;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">فتح الداشبورد</a></body></html>`);
});

app.get('/login', (req,res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&response_type=code&scope=identify%20guilds%20email`;
  res.redirect(url);
});

app.get('/auth/callback', async (req,res) => {
  const code = req.query.code;
  if (!code) return res.send('No code');
  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: config.redirectUri
    }), { headers: {'Content-Type':'application/x-www-form-urlencoded'} });
    const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
    req.session.user = userRes.data;
    db.logins.push({ id: userRes.data.id, username: userRes.data.username, time: new Date().toISOString(), action: 'login' });
    save();
    res.redirect('/dashboard');
  } catch(err) {
    res.send('فشل تسجيل الدخول - تأكد من Client Secret و Redirect URI: ' + (err.response?.data?.error || err.message));
  }
});

app.get('/logout', (req,res) => { req.session.destroy(()=>{}); res.redirect('/'); });

app.get('/api/me', async (req,res) => {
  if (!req.session.user) return res.status(401).json({error:'غير مسجل'});
  const guild = client.guilds.cache.get(config.guildId);
  let member = null;
  try { member = await guild?.members.fetch(req.session.user.id); } catch {}
  const points = db.points[req.session.user.id] || 0;
  const needed = db.promoPoints || 50;
  const remaining = needed - (points % needed);
  res.json({
    user: req.session.user,
    points: points,
    xp: db.xp[req.session.user.id] || 0,
    tickets: db.tickets[req.session.user.id] || 0,
    needed: needed,
    remaining: remaining,
    allPoints: db.points,
    logins: db.logins.slice(-50).reverse()
  });
});

app.post('/api/points/edit', async (req,res) => {
  if (!req.session.user) return res.status(401).json({error:'غير مسجل'});
  const { userId, action, amount } = req.body;
  if (!userId ||!amount) return res.status(400).json({error:'ناقص'});
  if (action === 'set') db.points[userId] = parseInt(amount);
  if (action === 'add') db.points[userId] = (db.points[userId]||0) + parseInt(amount);
  if (action === 'remove') db.points[userId] = Math.max(0,(db.points[userId]||0) - parseInt(amount));
  save();
  const guild = client.guilds.cache.get(config.guildId);
  try { const m = await guild.members.fetch(userId); await autoPromote(m); } catch {}
  res.json({ok:true, points: db.points[userId]});
});

app.get('/dashboard', (req,res) => {
  if (!req.session.user) return res.redirect('/login');
  res.send(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard</title><style>body{font-family:sans-serif;background:#0f0f0f;color:#fff;margin:0}.header{background:#1a1a1a;padding:20px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid red}.card{background:#2b2d31;margin:20px;padding:20px;border-radius:12px}.btn{background:red;color:#fff;padding:10px 18px;border:none;border-radius:6px;margin:4px;cursor:pointer}input{padding:10px;border-radius:6px;border:none;margin:4px}.progress{background:#333;height:22px;border-radius:11px;overflow:hidden;margin-top:10px}.bar{background:red;height:100%}</style></head><body><div class="header"><h2>🎫 Support Social Media</h2><div><span id="uname">...</span> | <a href="/logout" style="color:red">خروج</a></div></div><div class="card"><h3>📊 ملفي</h3><div id="myinfo">تحميل...</div></div><div class="card"><h3>🏆 توب 10</h3><div id="top">تحميل...</div></div><div class="card"><h3>🔐 تعديل نقاط</h3><input id="tid" placeholder="ID الادمن"><input id="amt" type="number" placeholder="العدد"><br><button class="btn" onclick="edit('add')">اضافة</button><button class="btn" onclick="edit('remove')">حذف</button><button class="btn" onclick="edit('set')">تحديد</button><div id="msg" style="margin-top:10px"></div></div><div style="text-align:center;padding:20px;color:#666">${config.footer} - شغال على mayor-cloud</div><script>async function load(){try{const r=await fetch('/api/me');if(r.status===401)return location='/login';const d=await r.json();document.getElementById('uname').innerText=d.user.username;document.getElementById('myinfo').innerHTML='⭐ نقاطك: '+d.points+'<br>💬 XP: '+d.xp+'<br>🎫 تذاكر: '+d.tickets+'<br>📈 باقيلك '+d.remaining+' نقطة للترقية (كل '+d.needed+')<div class=progress><div class=bar style=width:'+((d.points%d.needed)/d.needed*100)+'%></div></div>';let h='';Object.entries(d.allPoints).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([id,pts],i)=>{h+=(i+1)+'. '+id+' - '+pts+' نقطة<br>'});document.getElementById('top').innerHTML=h||'لا يوجد';}catch(e){document.getElementById('myinfo').innerText='خطأ: '+e}}async function edit(a){const userId=document.getElementById('tid').value;const amount=parseInt(document.getElementById('amt').value);if(!userId||isNaN(amount))return alert('املأ الحقول');const r=await fetch('/api/points/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,action:a,amount})});const d=await r.json();document.getElementById('msg').innerText=d.ok?'تم - نقاطه الان '+d.points:'خطأ';load()}load()</script></body></html>`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => { console.log(`🌐 موقع شغال على ${PORT}`); });

client.on('clientReady', async () => {
  console.log(`✅ ${client.user.tag} Online - ${config.footer}`);
  const commands = [
    { name: 'setup-ticket', description: 'نشر بانل التذاكر في الروم', default_member_permissions: '8' },
    { name: 'set-image', description: 'تغيير صورة بانل التذاكر', options: [{ name: 'url', type: 3, required: true, description: 'ضع رابط الصورة الجديدة' }], default_member_permissions: '8' },
    { name: 'set-youtube', description: 'تحديد رابط قنوات اليوتيوب', options: [{ name: 'url1', type: 3, required: true, description: 'رابط القناة الاولى' }, { name: 'url2', type: 3, required: true, description: 'رابط القناة الثانية' }], default_member_permissions: '8' },
    { name: 'set-promotion', description: 'تحديد كم نقطة تحتاج للترقية', options: [{ name: 'points', type: 4, required: true, description: 'مثال 50' }], default_member_permissions: '8' },
    { name: 'moderator', description: 'اوامر ادارة السيرفر للمشرفين', options: [
      { name: 'ban', type: 1, description: 'حظر عضو من السيرفر', options: [{ name: 'user', type: 6, required: true, description: 'اختار العضو' }] },
      { name: 'unbanall', type: 1, description: 'فك الحظر عن جميع المحظورين' },
      { name: 'kick', type: 1, description: 'طرد عضو من السيرفر', options: [{ name: 'user', type: 6, required: true, description: 'اختار العضو' }] },
      { name: 'clear', type: 1, description: 'مسح عدد من الرسائل', options: [{ name: 'amount', type: 4, required: true, description: 'عدد الرسائل' }] },
      { name: 'timeout', type: 1, description: 'اعطاء ميوت مؤقت لعضو', options: [{ name: 'user', type: 6, required: true, description: 'اختار العضو' }, { name: 'minutes', type: 4, required: true, description: 'المدة بالدقائق' }] },
      { name: 'lock', type: 1, description: 'قفل الروم الحالي' },
      { name: 'unlock', type: 1, description: 'فتح الروم الحالي' }
    ]},
    { name: 'points', description: 'التحكم بنظام نقاط الادمن', options: [
      { name: 'top', type: 1, description: 'عرض توب 10 اكثر ادمن نقاط' },
      { name: 'show', type: 1, description: 'عرض نقاط ادمن معين', options: [{ name: 'user', type: 6, required: true, description: 'اختار الادمن' }] },
      { name: 'add', type: 1, description: 'اضافة نقاط لادمن', options: [{ name: 'user', type: 6, required: true, description: 'اختار الادمن' }, { name: 'amount', type: 4, required: true, description: 'عدد النقاط' }] },
      { name: 'remove', type: 1, description: 'حذف نقاط من ادمن', options: [{ name: 'user', type: 6, required: true, description: 'اختار الادمن' }, { name: 'amount', type: 4, required: true, description: 'عدد النقاط' }] },
      { name: 'set', type: 1, description: 'تحديد نقاط ادمن بقيمة ثابتة', options: [{ name: 'user', type: 6, required: true, description: 'اختار الادمن' }, { name: 'amount', type: 4, required: true, description: 'القيمة الجديدة' }] },
      { name: 'reset', type: 1, description: 'تصفير نقاط كل الادمن' }
    ]},
    { name: 'admin-profile', description: 'عرض بروفايل الادمن مع نقاطه', options: [{ name: 'user', type: 6, required: false, description: 'اختار ادمن او اتركه فارغ لنفسك' }] },
    { name: 'dashboard', description: 'الحصول على رابط لوحة التحكم' }
  ];
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('✅ تم تسجيل كل الاوامر بنجاح');
  } catch (e) {
    console.error('❌ خطأ تسجيل الاوامر:', e.message);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  db.xp[message.author.id] = (db.xp[message.author.id] || 0) + 2;
  save();
  if (message.attachments.size > 0 && db.ticketsData[message.channel.id] && db.ticketsData[message.channel.id].type === 'subscription') {
    const data = db.ticketsData[message.channel.id];
    if (message.author.id!== data.owner) return;
    const attachment = message.attachments.first();
    if (!attachment.contentType ||!attachment.contentType.startsWith('image/')) return;
    await message.channel.send('🔍 تم استلام الصورة - جاري التحقق التلقائي...');
    try {
      const member = await message.guild.members.fetch(data.owner);
      await member.roles.add(config.subscriptionRoleId);
      await message.reply({ embeds: [new EmbedBuilder().setTitle('✅ تم التحقق تلقائيا').setDescription(`مبروك ${member} حصلت على <@&${config.subscriptionRoleId}>\nتم التأكد من اشتراكك`).setColor('Green').setFooter({text: config.footer})] });
      const logCh = client.channels.cache.get(config.logsChannelId);
      if (logCh) logCh.send({ embeds: [new EmbedBuilder().setTitle('✅ اشتراك تلقائي').setDescription(`العضو: ${member}\nالتذكرة: ${message.channel}`).setImage(attachment.url).setColor('Green').setTimestamp().setFooter({text: config.footer})] });
      setTimeout(() => message.channel.delete().catch(()=>{}), 10000);
    } catch (err) {
      message.reply('❌ فشل اعطاء الرتبة - تأكد رتبة البوت اعلى من رتبة الاشتراك');
    }
  }
});

client.on('interactionCreate', async (i) => {
  if (i.isChatInputCommand()) {
    if (i.commandName === 'dashboard') {
      return i.reply({ content: `🌐 رابط الداشبورد:\nhttps://support.mayor-cloud.site/dashboard\nhttps://support.mayor-cloud.site/login`, ephemeral: true });
    }
    if (i.commandName === 'setup-ticket') {
      const embed = new EmbedBuilder().setTitle('🎫 Support Social Media - نظام التذاكر').setDescription(`مرحبا في **${config.footer}**\n\n💎 **اشتراك يوتيوب**\n${db.subUrls?.url1 || config.youtubeChannel1Url}\n${db.subUrls?.url2 || config.youtubeChannel2Url}\nارسل سكرين والبوت يتأكد تلقائيا\n\n📩 **دعم فني**\n\n**الترقية التلقائية كل ${db.promoPoints} نقطة - البوت يكتشف سلم الرتب بنفسه**`).setImage(db.panelImage || config.panelImage).setColor('#2b2d31').setFooter({text: config.footer});
      const menu = new StringSelectMenuBuilder().setCustomId('ticket_select').setPlaceholder('اختر نوع التذكرة').addOptions({ label: 'اشتراك يوتيوب تلقائي', value: 'subscription', emoji: '💎', description: 'تحقق تلقائي بصورة الاشتراك' }, { label: 'دعم فني', value: 'support', emoji: '📩', description: 'فتح تذكرة دعم فني' });
      const row = new ActionRowBuilder().addComponents(menu);
      await i.channel.send({ embeds: [embed], components: [row] });
      return i.reply({ content: '✅ تم نشر بانل التذاكر', ephemeral: true });
    }
    if (i.commandName === 'set-image') { db.panelImage = i.options.getString('url'); save(); return i.reply({ content: '✅ تم تغيير صورة البانل', ephemeral: true }); }
    if (i.commandName === 'set-youtube') { db.subUrls = { url1: i.options.getString('url1'), url2: i.options.getString('url2') }; save(); return i.reply({ content: `✅ تم حفظ القنوات\n1: ${db.subUrls.url1}\n2: ${db.subUrls.url2}`, ephemeral: true }); }
    if (i.commandName === 'set-promotion') { db.promoPoints = i.options.getInteger('points'); save(); return i.reply({ content: `✅ تم التحديد - كل ${db.promoPoints} نقطة = ترقية تلقائية + سحب الرتبة القديمة`, ephemeral: true }); }
    if (i.commandName === 'moderator') {
      const sub = i.options.getSubcommand();
      if (sub === 'unbanall') { await i.deferReply(); const bans = await i.guild.bans.fetch(); for (const b of bans.values()) { await i.guild.members.unban(b.user.id).catch(()=>{}); } return i.editReply(`✅ تم فك الباند عن ${bans.size} عضو`); }
      if (sub === 'ban') { const u = i.options.getUser('user'); await i.guild.members.ban(u.id).catch(()=>{}); return i.reply(`✅ تم حظر ${u.tag}`); }
      if (sub === 'kick') { const m = i.options.getMember('user'); if (m) await m.kick().catch(()=>{}); return i.reply(`✅ تم طرد ${m?.user.tag}`); }
      if (sub === 'clear') { const n = i.options.getInteger('amount'); await i.channel.bulkDelete(n, true).catch(()=>{}); return i.reply({ content: `✅ تم مسح ${n}`, ephemeral: true }); }
      if (sub === 'timeout') { const m = i.options.getMember('user'); const mins = i.options.getInteger('minutes'); if (m) await m.timeout(mins*60*1000).catch(()=>{}); return i.reply(`✅ تم ميوت ${m?.user.tag} لمدة ${mins} دقيقة`); }
      if (sub === 'lock') { await i.channel.permissionOverwrites.edit(i.guild.id, { SendMessages: false }).catch(()=>{}); return i.reply('🔒 تم قفل الروم'); }
      if (sub === 'unlock') { await i.channel.permissionOverwrites.edit(i.guild.id, { SendMessages: null }).catch(()=>{}); return i.reply('🔓 تم فتح الروم'); }
    }
    if (i.commandName === 'points') {
      const sub = i.options.getSubcommand();
      if (sub === 'top') { const top = Object.entries(db.points).sort((a,b)=>b[1]-a[1]).slice(0,10); const desc = top.map(([id,pts],idx)=>`${idx+1}. <@${id}> - ${pts} نقطة`).join('\n') || 'لا يوجد نقاط'; return i.reply({ embeds: [new EmbedBuilder().setTitle('🏆 توب الادمن - Support Social Media').setDescription(desc).setColor('Gold').setFooter({text: config.footer})] }); }
      if (sub === 'show') { const u = i.options.getUser('user'); const pts = db.points[u.id] || 0; return i.reply(`⭐ نقاط ${u.tag}: ${pts} | باقي ${db.promoPoints - (pts % db.promoPoints)} للترقية`); }
      if (sub === 'add') { const u = i.options.getUser('user'); const a = i.options.getInteger('amount'); db.points[u.id] = (db.points[u.id]||0)+a; save(); const mem = await i.guild.members.fetch(u.id).catch(()=>null); if (mem) await autoPromote(mem); return i.reply(`✅ تم اضافة ${a} لـ ${u.tag} - المجموع ${db.points[u.id]}`); }
      if (sub === 'remove') { const u = i.options.getUser('user'); const a = i.options.getInteger('amount'); db.points[u.id] = Math.max(0,(db.points[u.id]||0)-a); save(); return i.reply(`✅ تم حذف ${a} من ${u.tag}`); }
      if (sub === 'set') { const u = i.options.getUser('user'); const a = i.options.getInteger('amount'); db.points[u.id]=a; save(); const mem = await i.guild.members.fetch(u.id).catch(()=>null); if (mem) await autoPromote(mem); return i.reply(`✅ تم تحديد نقاط ${u.tag} الى ${a}`); }
      if (sub === 'reset') { db.points={}; save(); return i.reply('✅ تم تصفير كل النقاط'); }
    }
    if (i.commandName === 'admin-profile') {
      const user = i.options.getUser('user') || i.user;
      const pts = db.points[user.id] || 0;
      return i.reply({ embeds: [new EmbedBuilder().setTitle(`👤 بروفايل ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields({name:'⭐ نقاط', value:`${pts}`, inline:true},{name:'💬 XP', value:`${db.xp[user.id]||0}`, inline:true},{name:'🎫 تذاكر', value:`${db.tickets[user.id]||0}`, inline:true},{name:'🚀 باقي للترقية', value:`${db.promoPoints - (pts % db.promoPoints)} نقطة`, inline:true},{name:'🎖️ كل ${db.promoPoints} نقطة = ترقية', value:'تلقائي', inline:true}).setColor('#2b2d31').setFooter({text: config.footer})] });
    }
  }

  if (i.isStringSelectMenu() && i.customId === 'ticket_select') {
    const type = i.values[0];
    const channel = await i.guild.channels.create({ name: `ticket-${i.user.username}`, type: ChannelType.GuildText, permissionOverwrites: [{ id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] });
    db.ticketsData[channel.id] = { owner: i.user.id, type: type, claimedBy: null };
    save();
    const desc = type === 'subscription'? `**💎 اشتراك يوتيوب**\nالقنوات:\n${db.subUrls?.url1 || config.youtubeChannel1Url}\n${db.subUrls?.url2 || config.youtubeChannel2Url}\n\n**ارسل صورة تثبت اشتراكك والبوت راح يتأكد تلقائيا ويعطيك <@&${config.subscriptionRoleId}>**` : `مرحبا ${i.user} في دعم ${config.footer}\nاكتب مشكلتك`;
    const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('claim').setLabel('استلام التذكرة').setStyle(ButtonStyle.Primary).setEmoji('🙋'), new ButtonBuilder().setCustomId('unclaim').setLabel('ترك لادمن اخر').setStyle(ButtonStyle.Secondary).setEmoji('🔄'), new ButtonBuilder().setCustomId('request_admin').setLabel('طلب ادمن').setStyle(ButtonStyle.Secondary).setEmoji('👑'));
    const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close').setLabel('اغلاق').setStyle(ButtonStyle.Danger).setEmoji('🔒'), new ButtonBuilder().setCustomId('delete').setLabel('حذف').setStyle(ButtonStyle.Danger).setEmoji('🗑️'));
    await channel.send({ content: `${i.user} | <@&${config.supportRoleId}>`, embeds: [new EmbedBuilder().setDescription(desc).setColor('#2b2d31').setFooter({text: config.footer})], components: [row1, row2] });
    await i.reply({ content: `✅ تم فتح تذكرتك ${channel}`, ephemeral: true });
  }

  if (i.isButton()) {
    if (i.customId === 'claim') { db.ticketsData[i.channel.id].claimedBy = i.user.id; db.points[i.user.id] = (db.points[i.user.id]||0)+1; db.tickets[i.user.id] = (db.tickets[i.user.id]||0)+1; save(); await autoPromote(i.member); await i.reply({ content: `🔵 ${i.user} استلم التذكرة +1 نقطة (المجموع ${db.points[i.user.id]})` }); }
    if (i.customId === 'unclaim') { if (db.ticketsData[i.channel.id]) db.ticketsData[i.channel.id].claimedBy = null; save(); await i.reply({ content: `⚪ ${i.user} ترك التذكرة - متاحة` }); }
    if (i.customId === 'request_admin') { await i.reply({ content: `👑 طلب ادمن <@&${config.supportRoleId}>` }); }
    if (i.customId === 'close') { await i.reply({ content: '🔒 سيتم اغلاق التذكرة بعد 3 ثواني' }); setTimeout(()=> i.channel.delete().catch(()=>{}), 3000); }
    if (i.customId === 'delete') { await i.reply({ content: '🗑️ سيتم الحذف' }); setTimeout(()=> i.channel.delete().catch(()=>{}), 2000); }
  }
});

client.login(config.token);
