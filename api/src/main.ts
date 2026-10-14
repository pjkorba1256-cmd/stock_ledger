import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Polyfill BigInt serialization to prevent JSON.stringify errors
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
