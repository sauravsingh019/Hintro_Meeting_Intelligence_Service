import { config } from './config.js';
import { createHttpServer } from './app.js';

const { server } = createHttpServer();

server.listen(config.port, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message: 'server_listening',
    port: config.port,
    databaseFile: config.databaseFile,
  }));
});
