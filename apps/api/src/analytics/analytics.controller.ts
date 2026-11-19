import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, ApiAcceptedResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Public } from '../common/auth';
import { AnalyticsService, ALLOWED_PROPS, CLIENT_EVENTS } from './analytics.service';

export class ClientEventBody {
  @ApiProperty({ enum: [...CLIENT_EVENTS] }) @IsString() @MaxLength(60) name!: string;
  @ApiPropertyOptional({ description: `Only these keys are accepted: ${ALLOWED_PROPS.join(', ')}. Values: specialty code, id, ISO market, SCREAMING_SNAKE code. Anything else is a 400.`, type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional() @IsObject() props?: Record<string, unknown>;
}
export class ClientEventsBody {
  @ApiProperty({ type: [ClientEventBody] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ClientEventBody) events!: ClientEventBody[];
}
export class IngestResultDto { @ApiProperty() accepted!: number }

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}
  @Public() @Post('events') @HttpCode(202)
  @ApiOperation({ summary: 'KX-03 §07 client analytics (PHI-free whitelist, anonymous, all-or-nothing batch)' })
  @ApiAcceptedResponse({ type: IngestResultDto })
  ingest(@Body() b: ClientEventsBody) { return this.svc.ingest(b.events); }
}
