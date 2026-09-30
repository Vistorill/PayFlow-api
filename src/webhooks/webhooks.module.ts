import { Module } from '@nestjs/common';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookFanoutService } from './webhook-fanout.service';
import { WebhookSegredosService } from './webhook-segredos.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Webhook Service: Endpoint Manager + fan-out dos eventos + Dispatcher. */
@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookSegredosService,
    WebhookDispatcherService,
    WebhookFanoutService,
  ],
})
export class WebhooksModule {}
