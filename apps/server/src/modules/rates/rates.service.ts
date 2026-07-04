import type { HistoricalRateCategory } from "@bmp/database";
import type { HistoricalRateDto } from "@bmp/types";

import { toHistoricalRateDto } from "./rates.mapper.js";
import type {
  CreateHistoricalRateData,
  IHistoricalRatesRepository,
  ListHistoricalRatesFilters,
} from "./rates.repository.js";

export class RatesService {
  constructor(private readonly ratesRepository: IHistoricalRatesRepository) {}

  async list(filters: ListHistoricalRatesFilters): Promise<HistoricalRateDto[]> {
    const rates = await this.ratesRepository.findMany(filters);
    return rates.map(toHistoricalRateDto);
  }

  async suggest(
    category: HistoricalRateCategory,
    itemName: string,
    limit: number,
  ): Promise<HistoricalRateDto[]> {
    const rates = await this.ratesRepository.suggest(category, itemName, limit);
    return rates.map(toHistoricalRateDto);
  }

  async create(data: CreateHistoricalRateData): Promise<HistoricalRateDto> {
    const rate = await this.ratesRepository.create(data);
    return toHistoricalRateDto(rate);
  }
}
