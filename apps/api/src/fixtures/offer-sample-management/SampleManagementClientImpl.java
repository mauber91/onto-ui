package example.sourcing.clients;

@DownstreamService("GST-SOURCING-SOURCING-SAMPLE-MANAGEMENT")
public class SampleManagementClientImpl {
  public SampleDTO create(CreateSampleRequest request) { return http.post("/samples", request); }
  public SampleDTO submit(String sampleId) { return http.post("/samples/" + sampleId + "/submit", null); }
  public SampleRequestDTO getRequest(String requestId) { return http.get("/sample-requests/" + requestId); }
}
