const fs = require('fs');
const path = require('path');
const AnsiConverter = require('ansi-to-html');
const ansiConvert = new AnsiConverter();

class LogMonitor {
  constructor() {
    this.watchers = new Map(); // 存储每个日志文件的监控器
    this.filePositions = new Map(); // 存储每个文件的读取位置
  }

  /**
   * 开始监控日志文件
   * @param {string} filePath - 日志文件路径
   * @param {Function} onNewLog - 新日志回调函数
   */
  watchLogFile(filePath, onNewLog) {
    if (!filePath) {
      console.error(`日志文件路径为空`);
      return null;
    }

    // 如果已经在监控，先停止
    if (this.watchers.has(filePath)) {
      this.stopWatching(filePath);
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.warn(`日志文件不存在，将在文件创建后开始监控: ${filePath}`);
      // 监控父目录，等待文件创建
      const dirPath = require('path').dirname(filePath);
      if (fs.existsSync(dirPath)) {
        const dirWatcher = fs.watch(dirPath, { persistent: true }, (eventType, filename) => {
          if (filename === require('path').basename(filePath) && fs.existsSync(filePath)) {
            dirWatcher.close();
            this.watchLogFile(filePath, onNewLog);
          }
        });
        return dirWatcher;
      }
      return null;
    }

    // 初始化文件位置为文件末尾
    try {
      const stats = fs.statSync(filePath);
      this.filePositions.set(filePath, stats.size);
    } catch (error) {
      console.error(`无法获取文件信息 ${filePath}:`, error);
      return null;
    }

    // 使用 fs.watch 监控文件变化
    const watcher = fs.watch(filePath, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        // 延迟一点读取，避免文件正在写入时读取不完整
        setTimeout(() => {
          this.readNewLogs(filePath, onNewLog);
        }, 100);
      } else if (eventType === 'rename') {
        // 文件被重命名或删除
        if (!fs.existsSync(filePath)) {
          console.warn(`日志文件被删除: ${filePath}`);
          this.stopWatching(filePath);
        }
      }
    });

    this.watchers.set(filePath, watcher);

    // 立即读取一次最新日志（如果有）
    this.readNewLogs(filePath, onNewLog);

    return watcher;
  }

  /**
   * 读取文件新增的日志内容
   */
  readNewLogs(filePath, onNewLog) {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.warn(`日志文件不存在: ${filePath}`);
        return;
      }

      const stats = fs.statSync(filePath);
      const currentSize = stats.size;
      const lastPosition = this.filePositions.get(filePath) || 0;

      if (currentSize < lastPosition) {
        // 文件被截断或重新创建，重置位置
        this.filePositions.set(filePath, 0);
        return;
      }

      if (currentSize === lastPosition) {
        // 没有新内容
        return;
      }

      // 读取新增内容
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(currentSize - lastPosition);
      fs.readSync(fd, buffer, 0, buffer.length, lastPosition);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf8');
      this.filePositions.set(filePath, currentSize);

      // 处理并发送新日志
      if (newContent.trim()) {
        const lines = newContent.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
          const htmlLines = lines.map(line => ansiConvert.toHtml(line)).join('<br/>');
          onNewLog(htmlLines);
        }
      }
    } catch (error) {
      // 如果文件不存在或被删除，不输出错误（可能是正常的）
      if (error.code !== 'ENOENT') {
        console.error(`读取日志文件错误 ${filePath}:`, error);
      }
    }
  }

  /**
   * 停止监控日志文件
   */
  stopWatching(filePath) {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
      this.filePositions.delete(filePath);
    }
  }

  /**
   * 停止所有监控
   */
  stopAll() {
    for (const [filePath, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    this.filePositions.clear();
  }
}

module.exports = new LogMonitor();
