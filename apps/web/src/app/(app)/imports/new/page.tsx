import {
  NewImport,
  type NewImportSearchParams,
} from '@playlarr/imports-web/server';

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<NewImportSearchParams>;
}) {
  return <NewImport searchParams={await searchParams} />;
}
