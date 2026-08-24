import { RouteObject } from "react-router-dom";

export const routes: RouteObject[] = [
  { path: "/products", element: <ProductsPage /> },
  { path: "/products/my-offers", element: <MyOffersPage /> },
  { path: "/products/:productId", element: <ProductPage /> },
  { path: "/products/:productId/offers", element: <OffersPage /> },
  { path: "/products/:productId/offers/new", element: <OfferEditorPage /> },
  { path: "/products/:productId/offers/:offerId", element: <OfferEditorPage /> },
  { path: "/products/:productId/samples", element: <SamplesPage /> },
  { path: "/products/:productId/samples/new", element: <SampleEditorPage /> },
  { path: "/products/:productId/sample-requests/:requestId", element: <SampleRequestPage /> },
  { path: "/products/:productId/sample-responses", element: <SampleResponsesPage /> },
  { path: "/products/:productId/sample-responses/:sampleId", element: <SampleResponsePage /> }
];
