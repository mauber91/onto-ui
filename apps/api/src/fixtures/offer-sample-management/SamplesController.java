package example.sourcing.controllers;

@RestController
@RequestMapping("/v1/supplier-response-bff/samples")
public class SamplesController {
  private final SamplesService samplesService;

  @PostMapping
  public SampleDTO create(CreateSampleRequest request) {
    return samplesService.create(request);
  }

  @PostMapping("/{sampleId}/submit")
  public SampleDTO submit(String sampleId) {
    return samplesService.submit(sampleId);
  }
}
