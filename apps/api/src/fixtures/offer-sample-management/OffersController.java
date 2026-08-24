package example.sourcing.controllers;

@RestController
@RequestMapping("/v1/supplier-response-bff/offers")
public class OffersController {
  private final OffersService offersService;
  private final OwnershipPolicy ownershipPolicy;

  @GetMapping
  public OfferListDTO list() {
    return offersService.list();
  }

  @PostMapping
  public OfferDTO create(CreateOfferRequest request) {
    ownershipPolicy.assertSupplierOwns(request.supplierId());
    return offersService.create(request);
  }

  @PutMapping("/{offerId}")
  public OfferDTO update(String offerId, UpdateOfferDTO request) {
    ownershipPolicy.assertSupplierOwns(request.supplierId());
    return offersService.update(offerId, request);
  }

  @PostMapping("/{offerId}/submit")
  public OfferDTO submit(String offerId) {
    ownershipPolicy.assertSupplierOwns(offerId);
    return offersService.submit(offerId);
  }

  @PostMapping("/{offerId}/clone")
  public OfferDTO cloneOffer(String offerId) {
    ownershipPolicy.assertSupplierOwns(offerId);
    return offersService.cloneOffer(offerId);
  }
}
