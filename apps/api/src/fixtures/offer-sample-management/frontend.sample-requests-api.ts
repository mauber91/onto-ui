import type { SupplierSampleResponse } from "../models/swagger";
import { supplierResponseClient } from "./client";

export async function getSampleRequest(requestId: string): Promise<SupplierSampleResponse> {
  return supplierResponseClient.get<SupplierSampleResponse>(`/v1/supplier-response-bff/sample-requests/${requestId}`);
}
