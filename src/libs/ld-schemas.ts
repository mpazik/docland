import { Article, WithContext } from "schema-dts";

export const createArticle = (
  id: string,
  name: string,
  encodingFormat: string,
  urls?: string[]
): WithContext<Article> => ({
  "@context": "https://schema.org",
  "@type": "Article",
  "@id": id,
  encodingFormat,
  name,
  url: urls,
});
