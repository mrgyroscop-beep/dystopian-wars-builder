import { useEffect } from "react";

const PRODUCT_NAME = "Dystopian Wars Builder";

export function useDocumentTitle(pageTitle: string) {
  useEffect(() => {
    document.title = `${pageTitle} — ${PRODUCT_NAME}`;
  }, [pageTitle]);
}
