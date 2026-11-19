import { ApiProperty } from '@nestjs/swagger';
import { EmergencyDto, SpecialtyDto } from '../common/shared.dto';

export class AiLabelDto { badge!: string; copyEn!: string; copyAr!: string }
export class NavigationResultDto {
  @ApiProperty({ enum: ['AI', 'RULES'] }) source!: string;
  @ApiProperty({ description: 'true only when a model produced the suggestion (AI badge)' }) ai!: boolean;
  @ApiProperty({ type: [SpecialtyDto] }) specialties!: SpecialtyDto[];
  @ApiProperty({ type: AiLabelDto, required: false }) label?: AiLabelDto;
  @ApiProperty({ required: false, description: 'Why the rules path answered: FLAG_AWAITING_GATE, NO_AI_CONSENT, QUOTA_EXCEEDED, PROVIDER_ERROR...' }) fallbackReason?: string;
  @ApiProperty({ type: EmergencyDto, required: false }) emergency?: EmergencyDto;
}
