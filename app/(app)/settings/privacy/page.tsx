import { getSessionUserId } from "@/lib/auth/session";
import { getPrivacyRepository } from "@/lib/repositories/factory";
import { PrivacySettingsForm } from "@/components/settings/PrivacySettingsForm";

export default async function PrivacySettingsPage() {
  const userId = (await getSessionUserId())!;
  const settings = await getPrivacyRepository().getSettings(userId);

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">공개 범위 설정</h1>
        <p className="mt-1 text-sm text-foreground-muted">누가 내 방문과 후기를 볼 수 있는지 관리해요.</p>
      </div>
      <PrivacySettingsForm initial={settings} />
    </div>
  );
}
