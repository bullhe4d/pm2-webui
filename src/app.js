#!/usr/bin/env node

const config = require('./config')
const { setEnvDataSync } = require('./utils/env.util')
const { generateRandomString } = require('./utils/random.util')
const path = require('path');
const http = require('http');
const serve = require('koa-static');
const render = require('koa-ejs');
const koaBody = require('koa-body');
const session = require('koa-session');
const Koa = require('koa');
const WebSocketService = require('./services/websocket.service');

// Init Application

if(!config.APP_USERNAME || !config.APP_PASSWORD){
    console.log("You must first setup admin user. Run command -> npm run setup-admin-user")
    process.exit(2)
}

if(!config.APP_SESSION_SECRET){
    const randomString = generateRandomString()
    setEnvDataSync(config.APP_DIR, { APP_SESSION_SECRET: randomString})
    config.APP_SESSION_SECRET = randomString
}

// Create App Instance
const app = new Koa();

// App Settings
app.proxy = true;
app.keys = [config.APP_SESSION_SECRET];

// Middlewares
app.use(session(app));

app.use(koaBody());

app.use(serve(path.join(__dirname, 'public')));

const router = require("./routes");
app.use(router.routes());

render(app, {
    root: path.join(__dirname, 'views'),
    layout: 'base',
    viewExt: 'html',
    cache: false,
    debug: false
});

// 创建 HTTP 服务器
const server = http.createServer(app.callback());

// 初始化 WebSocket 服务
const wsService = new WebSocketService(server);

// 启动服务器
server.listen(config.PORT, config.HOST, () => {
    console.log(`Application started at http://${config.HOST}:${config.PORT}`)
    console.log(`WebSocket server ready at ws://${config.HOST}:${config.PORT}/ws/logs`)
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    wsService.close();
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('收到 SIGINT 信号，正在关闭服务器...');
    wsService.close();
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});