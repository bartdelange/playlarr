import { Suspense } from 'react';
import {
  ImportDashboard,
  ImportDashboardSkeleton,
} from '@playlarr/imports-web/server';

export default function HomePage() {
  return (
    <Suspense fallback={<ImportDashboardSkeleton />}>
      <ImportDashboard />
    </Suspense>
  );
}
