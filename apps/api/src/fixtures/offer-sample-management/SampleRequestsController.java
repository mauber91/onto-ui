package example.sourcing.controllers;

@RestController
@RequestMapping("/v1/supplier-response-bff/sample-requests")
public class SampleRequestsController {
  private final SampleRequestsService sampleRequestsService;

  @GetMapping("/{requestId}")
  public SupplierSampleResponseDTO get(String requestId) {
    return sampleRequestsService.get(requestId);
  }
}
