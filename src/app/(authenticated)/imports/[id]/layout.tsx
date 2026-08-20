import { ActiveNav } from "../../../../components/navigation/active-nav";

export default async function ImportWorkflowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <div className="import-nav-shell">
        <ActiveNav
          className="import-nav"
          label="Import navigation"
          items={[
            { href: `/imports/${id}`, label: "Overview", exact: true },
            { href: `/imports/${id}/revisions`, label: "History" },
            {
              href: `/imports/${id}/mapping-overrides`,
              label: "Reuse mappings",
            },
            {
              href: `/imports/${id}/local-additions`,
              label: "Local additions",
            },
          ]}
        />
      </div>
      {children}
    </>
  );
}
