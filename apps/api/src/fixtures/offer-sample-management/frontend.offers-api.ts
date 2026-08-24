import type { CreateOfferRequest, Offer, OfferList } from "../models/swagger";
import { supplierResponseClient } from "./client";

export async function listMyOffers(): Promise<OfferList> {
  return supplierResponseClient.get<OfferList>("/v1/supplier-response-bff/offers");
}

export async function createOffer(input: CreateOfferRequest): Promise<Offer> {
  return supplierResponseClient.post<Offer>("/v1/supplier-response-bff/offers", input);
}

export async function updateOffer(offerId: string, input: Partial<CreateOfferRequest>): Promise<Offer> {
  return supplierResponseClient.put<Offer>(`/v1/supplier-response-bff/offers/${offerId}`, input);
}

export async function submitOffer(offerId: string): Promise<Offer> {
  return supplierResponseClient.post<Offer>(`/v1/supplier-response-bff/offers/${offerId}/submit`, {});
}

export async function cloneOffer(offerId: string): Promise<Offer> {
  return supplierResponseClient.post<Offer>(`/v1/supplier-response-bff/offers/${offerId}/clone`, {});
}
