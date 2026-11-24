import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { PromotionQuoteService } from './promotion-quote.service';

class QuoteQuery { @IsString() @MaxLength(80) bookingId!: string }
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** Patient quote: the sponsored line of one of MY bookings, labelled "Discount sponsored by <clinic>" with the end date. 404 when it is not mine; `{ quote: null }` when nothing is eligible. */
@ApiTags('growth-sponsored-promotions')
@Controller('growth/v1/promotions')
@RequiresFlag(GROWTH_FLAG.SPONSORED_PROMOTIONS)
export class PromotionsPublicController {
  constructor(private readonly quotes: PromotionQuoteService) {}
  @Get('quote') @ApiOperation({ summary: 'GRW-P2-S the sponsored discount line for my booking, if any' }) @ApiOkResponse(OBJ)
  async quote(@CurrentUser() u: AuthUser, @Query() q: QuoteQuery) { return { quote: await this.quotes.quote(u.sub, q.bookingId) }; }
}
