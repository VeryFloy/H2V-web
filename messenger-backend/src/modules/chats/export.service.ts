import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { prisma } from '../../config/database';

interface ExportMessage {
  id: string;
  date: string;
  sender: string;
  senderNickname: string;
  type: string;
  text: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
  isEdited: boolean;
  replyToId: string | null;
}

const BATCH_SIZE = 500;

async function fetchAllMessages(chatId: string): Promise<ExportMessage[]> {
  const messages: ExportMessage[] = [];
  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.message.findMany({
      where: { chatId, isDeleted: false },
      select: {
        id: true,
        createdAt: true,
        type: true,
        text: true,
        mediaUrl: true,
        mediaName: true,
        isEdited: true,
        replyToId: true,
        sender: { select: { nickname: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;

    for (const m of batch) {
      const name = m.sender.firstName
        ? `${m.sender.firstName}${m.sender.lastName ? ' ' + m.sender.lastName : ''}`
        : m.sender.nickname;
      messages.push({
        id: m.id,
        date: m.createdAt.toISOString(),
        sender: name,
        senderNickname: m.sender.nickname,
        type: m.type,
        text: m.text,
        mediaUrl: m.mediaUrl,
        mediaName: m.mediaName,
        isEdited: m.isEdited,
        replyToId: m.replyToId,
      });
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  return messages;
}

function renderHtml(chatName: string, messages: ExportMessage[]): string {
  const rows = messages.map((m) => {
    const time = new Date(m.date).toLocaleString('ru-RU', { timeZone: 'UTC' });
    const edited = m.isEdited ? ' <em>(edited)</em>' : '';
    let content = '';
    if (m.text) content = escapeHtml(m.text);
    if (m.mediaName) {
      const file = m.mediaName;
      content += content ? '<br>' : '';
      content += `<a href="media/${file}">${escapeHtml(file)}</a>`;
    }
    if (m.replyToId) content = `<span style="color:#888">↩ reply</span> ` + content;
    return `<tr><td style="white-space:nowrap;vertical-align:top;padding:4px 12px 4px 0;color:#888">${time}</td><td style="vertical-align:top;padding:4px 12px 4px 0;font-weight:600">${escapeHtml(m.sender)}</td><td style="padding:4px 0">${content}${edited}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat Export — ${escapeHtml(chatName)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:960px;margin:40px auto;padding:0 20px;background:#fafafa;color:#222}
h1{font-size:20px;margin-bottom:24px}
table{width:100%;border-collapse:collapse}
tr:nth-child(even){background:#f0f0f0}
</style></head><body>
<h1>Chat: ${escapeHtml(chatName)}</h1>
<p>Exported: ${new Date().toISOString()}</p>
<p>Messages: ${messages.length}</p>
<hr style="margin:16px 0">
<table>${rows}</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function exportChat(
  chatId: string,
  userId: string,
  format: 'json' | 'html',
  res: Response,
) {
  const member = await prisma.chatMember.findFirst({ where: { chatId, userId } });
  if (!member) throw new Error('Not a member of this chat');

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { name: true, type: true },
  });
  if (!chat) throw new Error('Chat not found');

  const chatName = chat.name || 'Direct Chat';
  const messages = await fetchAllMessages(chatId);
  const uploadsDir = path.join(__dirname, '../../../../uploads');

  const archive = archiver('zip', { zlib: { level: 6 } });
  const filename = `h2v-export-${chatId.slice(0, 8)}-${Date.now()}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);

  if (format === 'json') {
    const data = { chatName, chatType: chat.type, exportedAt: new Date().toISOString(), messages };
    archive.append(JSON.stringify(data, null, 2), { name: 'chat.json' });
  } else {
    archive.append(renderHtml(chatName, messages), { name: 'chat.html' });
  }

  appendMedia(archive, messages, uploadsDir);
  await archive.finalize();
}

export async function exportAllChats(
  userId: string,
  format: 'json' | 'html',
  res: Response,
) {
  const memberships = await prisma.chatMember.findMany({
    where: { userId },
    select: {
      chat: { select: { id: true, name: true, type: true, members: { select: { user: { select: { nickname: true, firstName: true, lastName: true } } } } } },
    },
  });

  const archive = archiver('zip', { zlib: { level: 6 } });
  const filename = `h2v-export-all-${Date.now()}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);

  const uploadsDir = path.join(__dirname, '../../../../uploads');

  for (const m of memberships) {
    const chat = m.chat;
    const chatName = chat.name || chat.members.map(cm => cm.user.nickname).join(', ') || 'Chat';
    const safeName = chatName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ _-]/g, '').slice(0, 40) || chat.id.slice(0, 8);
    const dir = `${safeName}_${chat.id.slice(0, 6)}`;

    const messages = await fetchAllMessages(chat.id);
    if (messages.length === 0) continue;

    if (format === 'json') {
      const data = { chatName, chatType: chat.type, exportedAt: new Date().toISOString(), messages };
      archive.append(JSON.stringify(data, null, 2), { name: `${dir}/chat.json` });
    } else {
      archive.append(renderHtml(chatName, messages), { name: `${dir}/chat.html` });
    }

    appendMedia(archive, messages, uploadsDir, `${dir}/media`);
  }

  await archive.finalize();
}

function appendMedia(archive: archiver.Archiver, messages: ExportMessage[], uploadsDir: string, prefix = 'media') {
  const resolvedUploads = path.resolve(uploadsDir);
  const mediaMessages = messages.filter((m) => m.mediaUrl);
  for (const m of mediaMessages) {
    if (!m.mediaUrl) continue;
    const relativePath = m.mediaUrl.replace(/^\/uploads\//, '');
    const fullPath = path.resolve(uploadsDir, relativePath);
    if (!fullPath.startsWith(resolvedUploads + path.sep) && fullPath !== resolvedUploads) continue;
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(relativePath);
      const rawName = m.mediaName || `${m.id}${ext}`;
      const name = path.basename(rawName).replace(/[/\\]/g, '_');
      archive.file(fullPath, { name: `${prefix}/${name}` });
    }
  }
}
