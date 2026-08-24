package example.sourcing.services;

@Service
public class SamplesServiceImpl {
  private final SampleManagementClientImpl sampleManagementClient;

  public SampleDTO create(CreateSampleRequest request) {
    return sampleManagementClient.create(request);
  }

  public SampleDTO submit(String sampleId) {
    return sampleManagementClient.submit(sampleId);
  }
}
