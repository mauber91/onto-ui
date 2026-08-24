package example.sourcing.clients;

@DownstreamService("ESP-QUOTE-ESP-QUOTE")
public class EspQuoteClientImpl {
  public OfferDTO create(CreateOfferRequest request) { return http.post("/quotes", request); }
  public OfferDTO update(String offerId, UpdateOfferDTO request) { return http.put("/quotes/" + offerId, request); }
  public OfferDTO submit(String offerId) { return http.post("/quotes/" + offerId + "/submit", null); }
  public OfferDTO cloneOffer(String offerId) { return http.post("/quotes/" + offerId + "/clone", null); }
}
