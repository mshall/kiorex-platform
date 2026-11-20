import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { OkDto } from '../common/dto';
import { AddressDto } from './address.dto';
import { AddressService } from './address.service';

class HomeAddressBody {
  @IsString() @MinLength(1) @MaxLength(40) label!: string;
  @IsString() @MinLength(2) @MaxLength(60) governorate!: string;
  @IsString() @MaxLength(40) district!: string;
  @IsString() @MinLength(1) @MaxLength(200) street!: string;
  @IsOptional() @IsString() @MaxLength(20) building?: string;
  @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @IsOptional() @IsString() @MaxLength(20) flat?: string;
  @IsOptional() @IsString() @MaxLength(120) landmark?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsBoolean() makeDefault?: boolean;
}
class AddressPatch {
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @IsString() @MaxLength(60) governorate?: string;
  @IsOptional() @IsString() @MaxLength(40) district?: string;
  @IsOptional() @IsString() @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(20) building?: string;
  @IsOptional() @IsString() @MaxLength(20) floor?: string;
  @IsOptional() @IsString() @MaxLength(20) flat?: string;
  @IsOptional() @IsString() @MaxLength(120) landmark?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsBoolean() makeDefault?: boolean;
}

@ApiTags('address-book')
@Controller('me/addresses')
export class AddressController {
  constructor(private readonly svc: AddressService) {}

  @ApiOkResponse({ type: AddressDto, isArray: true })
  @Get() @ApiOperation({ summary: 'KXMHV01 address book (encrypted at rest; only the owner ever receives doorstep lines)' })
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u.sub); }

  @ApiCreatedResponse({ type: AddressDto })
  @Post() @ApiOperation({ summary: 'KXMHV01 add an address: label, governorate, district code, street, building, floor, flat, landmark, optional map pin' })
  create(@CurrentUser() u: AuthUser, @Body() b: HomeAddressBody) { return this.svc.create(u, b); }

  @ApiOkResponse({ type: AddressDto })
  @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: AddressPatch) { return this.svc.update(u, id, b); }

  @ApiOkResponse({ type: OkDto })
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.remove(u.sub, id); }

  @ApiOkResponse({ type: AddressDto })
  @Post(':id/confirm') @HttpCode(200) @ApiOperation({ summary: 'KXMHV01 confirm this address with the OTP-verified phone (required once before the first home booking; any edit of district/street resets it)' })
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.confirm(u, id); }
}
