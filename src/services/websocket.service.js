const WebSocket = require('ws');
const logMonitor = require('./log-monitor.service');
const { describeApp } = require('../providers/pm2/api');

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/logs'
    });
    this.clients = new Map(); // 存储客户端连接信息
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      console.log('新的 WebSocket 连接建立');

      // 解析查询参数获取应用名和日志类型
      // req.url 格式: /ws/logs?appName=xxx&logType=stdout
      const urlParts = req.url.split('?');
      const queryString = urlParts.length > 1 ? urlParts[1] : '';
      const params = new URLSearchParams(queryString);
      const appName = params.get('appName');
      const logType = params.get('logType');

      if (!appName || !logType) {
        ws.close(1008, '缺少必要参数: appName 和 logType');
        return;
      }

      if (logType !== 'stdout' && logType !== 'stderr') {
        ws.close(1008, 'logType 必须是 stdout 或 stderr');
        return;
      }

      // 获取应用信息和日志文件路径
      describeApp(appName)
        .then(app => {
          if (!app) {
            ws.close(1008, '应用不存在');
            return;
          }

          const filePath = logType === 'stdout' ? app.pm_out_log_path : app.pm_err_log_path;
          const clientId = `${appName}_${logType}_${Date.now()}`;

          // 存储客户端信息
          this.clients.set(ws, {
            id: clientId,
            appName,
            logType,
            filePath
          });

          // 开始监控日志文件
          logMonitor.watchLogFile(filePath, (newLogs) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'log',
                data: newLogs
              }));
            }
          });

          // 发送连接成功消息
          ws.send(JSON.stringify({
            type: 'connected',
            message: `已连接到 ${appName} 的 ${logType} 日志流`
          }));

          // 处理客户端消息
          ws.on('message', (message) => {
            try {
              const data = JSON.parse(message);
              if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
              }
            } catch (error) {
              console.error('处理 WebSocket 消息错误:', error);
            }
          });

          // 处理连接关闭
          ws.on('close', () => {
            const clientInfo = this.clients.get(ws);
            if (clientInfo) {
              logMonitor.stopWatching(clientInfo.filePath);
              this.clients.delete(ws);
              console.log(`客户端 ${clientInfo.id} 已断开连接`);
            }
          });

          // 处理错误
          ws.on('error', (error) => {
            console.error('WebSocket 错误:', error);
            const clientInfo = this.clients.get(ws);
            if (clientInfo) {
              logMonitor.stopWatching(clientInfo.filePath);
              this.clients.delete(ws);
            }
          });
        })
        .catch(error => {
          console.error('获取应用信息错误:', error);
          ws.close(1011, '获取应用信息失败');
        });
    });
  }

  /**
   * 关闭所有连接
   */
  close() {
    for (const [ws, clientInfo] of this.clients) {
      logMonitor.stopWatching(clientInfo.filePath);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    this.clients.clear();
    this.wss.close();
  }
}

module.exports = WebSocketService;
