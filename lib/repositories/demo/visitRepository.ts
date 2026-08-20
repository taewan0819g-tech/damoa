import type { UUID, Visit } from "@/types/domain";
import type { CreateVisitInput, VisitRepository } from "@/lib/repositories/types";
import { demoStore } from "@/lib/demo/store";

export class DemoVisitRepository implements VisitRepository {
  async getByPlace(placeId: UUID): Promise<Visit[]> {
    return demoStore.visits.filter((v) => v.placeId === placeId);
  }

  async getByUser(userId: UUID): Promise<Visit[]> {
    return demoStore.visits.filter((v) => v.userId === userId);
  }

  async create(input: CreateVisitInput): Promise<Visit> {
    const visit: Visit = {
      id: demoStore.nextId("v"),
      userId: input.userId,
      placeId: input.placeId,
      visitedAt: input.visitedAt,
      visibility: input.visibility,
      photoUrl: null,
      companionIds: input.companionIds ?? [],
    };
    demoStore.visits.unshift(visit);
    return visit;
  }

  async remove(visitId: UUID, requesterId: UUID): Promise<void> {
    const visit = demoStore.visits.find((v) => v.id === visitId);
    if (!visit || visit.userId !== requesterId) return;
    demoStore.visits = demoStore.visits.filter((v) => v.id !== visitId);
  }
}
