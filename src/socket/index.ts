import IO = require('koa-socket-2');
import Message from '../models/Message';
import Chat from '../models/Chat';
import User from '../models/user';
import * as cookie from 'cookie';

const onlineUsers = new Map();

function decodeCookie(cookie) {
  const decodedCookie = Buffer.from(cookie, 'base64').toString('utf8');
  return JSON.parse(decodedCookie);
}

function getSession(cookies, cookieKey) {
  const parsedCookies = cookie.parse(cookies || '');
  const sessionCookie = parsedCookies[cookieKey];
  if (sessionCookie) {
    const decodedCookie = decodeCookie(sessionCookie);
    if (decodedCookie.passport && decodedCookie.passport.user && Object.keys(decodedCookie.passport.user).length !== 0) {
      return decodedCookie.passport.user;
    }
  }
  return false;
}

const io = new IO();

io.use(async (ctx, next) => {
  console.log('auth middleware');
  const cookieKey = 'sess:key';
  const userId = getSession(ctx.socket.socket.request.headers.cookie, cookieKey);
  if (userId) {
    ctx.state = {
      isAuth: true,
      userId
    };
  } else {
    ctx.state = {
      isAuth: false
    };
  }
  await next();
})

io.on('connection', async (ctx) => {
  console.log(`connected ${ctx.socket.id}`)
  const cookieKey = 'sess:key';
  const userId = getSession(ctx.socket.request.headers.cookie, cookieKey);
  if (userId) {
    const socket = ctx.socket;
    onlineUsers.set(userId, socket);
  }
});

io.on('disconnect', async (ctx) => {
  console.log(`disconnected ${ctx.socket.id}`)
  if (ctx.state.isAuth) {
    onlineUsers.delete(ctx.state.userId);
  }
});

io.on('error', (error) => {
  console.log('error');
  console.log(error);
});

io.on('newMessage', async (ctx, data) => {
  console.log('event newMessage');
  try {
    if (!ctx.state.isAuth) {
      throw new Error('User is not authenticated');
    }

    const authorId = ctx.state.userId;
    const { text, partnerId } = data;

    console.log('authorId:', authorId);
    console.log('text:', text);
    console.log('partnerId:', partnerId);

    const messageData = {
      userId: authorId,
      content: text
    };
    const message = await Message.create(messageData) as any;

    let chat = await Chat.findOne({ members: { $all: [authorId, partnerId] } }) as any;

    if (!chat) {
      console.log('creating chat');
      chat = await Chat.create({ members: [authorId, partnerId] });
      await User.findByIdAndUpdate(authorId, { $push: { chats: chat._id } });
      await User.findByIdAndUpdate(partnerId, { $push: { chats: chat._id } });
    } else {
      console.log('getting chat');
    }

    chat.messages.push(message._id);
    await chat.save();

    const response = {
      chatId: chat._id,
      messageId: message._id,
      read: message.read,
      userId: message.userId,
      content: message.content,
      date: message.date
    }
    
    if (onlineUsers.has(partnerId)) {
      console.log(`partner ${partnerId} is online`);
      const partnerSocket = onlineUsers.get(partnerId);
      partnerSocket.emit('newMessage', response);
    } else {
      console.log(`partner ${partnerId} is offline`);
    }

    ctx.socket.emit('newMessage', response);
  } catch (error) {
    console.log('error');
    console.log(error);
    // ctx.socket.emit('error', error);
  }
});

io.on('test', async (ctx, data) => {
  // ctx.socket.emit('test', data);
  for (const socketObject of onlineUsers.values()) {
    socketObject.emit('test', data);
  }
});

export default io;
