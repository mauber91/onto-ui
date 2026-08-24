package example.sourcing.clients;

@DownstreamService("ESP-PLUM-UBER-API")
public class UberClientImpl {
  public OfferListDTO searchOffers() { return http.get("/offers/search"); }
  public ProductMeasurementDTO getProductMeasurements(String productId) { return http.get("/products/" + productId + "/measurements"); }
}
