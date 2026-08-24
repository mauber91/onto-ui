import type { CreateSampleRequest, Sample } from "../models/swagger";
import { supplierResponseClient } from "./client";

export async function createSample(input: CreateSampleRequest): Promise<Sample> {
  return supplierResponseClient.post<Sample>("/v1/supplier-response-bff/samples", input);
}

export async function submitSample(sampleId: string): Promise<Sample> {
  return supplierResponseClient.post<Sample>(`/v1/supplier-response-bff/samples/${sampleId}/submit`, {});
}
