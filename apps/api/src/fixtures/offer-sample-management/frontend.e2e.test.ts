test("sample request detail uses the BFF contract", async () => {
  await expect(page).toHaveURL(/sample-requests/);
  await expect(requestUrl).toContain("/v1/supplier-response-bff/sample-requests/");
});
