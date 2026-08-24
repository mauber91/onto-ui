package example.sourcing.services;

@Service
public class SampleRequestsServiceImpl {
  private final SampleManagementClientImpl sampleManagementClient;
  private final UberClientImpl uberClient;

  public SupplierSampleResponseDTO get(String requestId) {
    SampleRequestDTO request = sampleManagementClient.getRequest(requestId);
    ProductMeasurementDTO measurements = uberClient.getProductMeasurements(request.productId());
    return SupplierSampleResponseDTO.enriched(request, measurements);
  }
}
