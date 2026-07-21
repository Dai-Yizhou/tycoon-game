import * as winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'output/logs/training.log',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      )
    })
  ]
});

export class Logger {
  info(message: string): void {
    logger.info(message);
  }
  
  error(message: string, error?: any): void {
    if (error) {
      logger.error(`${message}: ${error.message}`, error);
    } else {
      logger.error(message);
    }
  }
  
  warn(message: string): void {
    logger.warn(message);
  }
  
  debug(message: string): void {
    logger.debug(message);
  }
}
