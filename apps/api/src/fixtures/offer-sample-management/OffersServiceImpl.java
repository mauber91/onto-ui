package example.sourcing.services;

@Service
public class OffersServiceImpl {
  private final EspQuoteClientImpl espQuoteClient;
  private final UberClientImpl uberClient;

  public OfferListDTO list() {
    return uberClient.searchOffers();
  }

  public OfferDTO create(CreateOfferRequest request) {
    return espQuoteClient.create(request);
  }

  public OfferDTO update(String offerId, UpdateOfferDTO request) {
    return espQuoteClient.update(offerId, request);
  }

  public OfferDTO submit(String offerId) {
    return espQuoteClient.submit(offerId);
  }

  public OfferDTO cloneOffer(String offerId) {
    return espQuoteClient.cloneOffer(offerId);
  }
}
