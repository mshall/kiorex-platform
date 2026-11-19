import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { AiGatewayService } from './ai-gateway.service';
import { NavigationResultDto } from './ai.dto';


class NavBody { @IsString() @MaxLength(1000) text!: string }

@ApiTags('ai')
@Controller('navigation')
export class AiGatewayController {
  constructor(private readonly svc: AiGatewayService) {}
  @ApiOkResponse({ type: NavigationResultDto })
  @Post('symptoms') @HttpCode(200)
  @ApiOperation({ summary: 'Symptom → specialty navigation (emergency check first; AI only when kiorex.ai_navigation is effective, else keyword map)' })
  navigate(@CurrentUser() u: AuthUser, @Body() b: NavBody) { return this.svc.navigate(u.sub, b.text); }
}
