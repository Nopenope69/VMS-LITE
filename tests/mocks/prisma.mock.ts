import crypto from 'node:crypto';

class MockCollection<T extends { id: string }> {
  private items = new Map<string, T>();

  async findMany(args?: { where?: any; orderBy?: any; select?: any }): Promise<T[]> {
    let result = Array.from(this.items.values());

    if (args?.where) {
      result = result.filter((item) => this.matchWhere(item, args.where));
    }

    if (args?.orderBy) {
      const field = Object.keys(args.orderBy)[0];
      const dir = args.orderBy[field];
      result.sort((a: any, b: any) => {
        const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
        const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
        if (valA < valB) return dir === 'desc' ? 1 : -1;
        if (valA > valB) return dir === 'desc' ? -1 : 1;
        return 0;
      });
    }

    return result.map((item) => ({ ...item }));
  }

  async findUnique(args: { where: any; select?: any }): Promise<T | null> {
    const all = Array.from(this.items.values());
    const match = all.find((item) => this.matchWhere(item, args.where));
    return match ? { ...match } : null;
  }

  async findFirst(args?: { where?: any; orderBy?: any; select?: any }): Promise<T | null> {
    const list = await this.findMany(args);
    return list.length > 0 ? list[0] : null;
  }

  async create(args: { data: any }): Promise<T> {
    const id = args.data.id || crypto.randomUUID();
    const now = new Date();
    const record: any = {
      id,
      createdAt: now,
      updatedAt: now,
      ...args.data,
    };
    this.items.set(id, record);
    return { ...record };
  }

  async upsert(args: { where: any; create: any; update: any }): Promise<T> {
    const existing = await this.findUnique({ where: args.where });
    if (existing) {
      return await this.update({ where: args.where, data: args.update });
    } else {
      return await this.create({ data: { ...args.where, ...args.create } });
    }
  }

  async update(args: { where: any; data: any }): Promise<T> {
    const existing = await this.findUnique({ where: args.where });
    if (!existing) {
      const err: any = new Error('Record to update not found.');
      err.code = 'P2025';
      throw err;
    }
    const updated: any = {
      ...existing,
      ...args.data,
      updatedAt: new Date(),
    };
    this.items.set(existing.id, updated);
    return { ...updated };
  }

  async delete(args: { where: any }): Promise<T> {
    const existing = await this.findUnique({ where: args.where });
    if (!existing) {
      const err: any = new Error('Record to delete not found.');
      err.code = 'P2025';
      throw err;
    }
    this.items.delete(existing.id);
    return { ...existing };
  }

  async deleteMany(args?: { where?: any }): Promise<{ count: number }> {
    let count = 0;
    for (const [id, item] of Array.from(this.items.entries())) {
      if (!args?.where || this.matchWhere(item, args.where)) {
        this.items.delete(id);
        count++;
      }
    }
    return { count };
  }

  async createMany(args: { data: any[] }): Promise<{ count: number }> {
    let count = 0;
    for (const d of args.data) {
      await this.create({ data: d });
      count++;
    }
    return { count };
  }

  async count(args?: { where?: any }): Promise<number> {
    const list = await this.findMany(args);
    return list.length;
  }

  clear(): void {
    this.items.clear();
  }

  private toEpoch(val: any): number | null {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string' || typeof val === 'number') {
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private matchWhere(item: any, where: any): boolean {
    for (const [key, val] of Object.entries(where)) {
      if (val === undefined) continue;

      if (key === 'OR' && Array.isArray(val)) {
        if (!val.some((cond) => this.matchWhere(item, cond))) return false;
        continue;
      }

      if (key === 'AND' && Array.isArray(val)) {
        if (!val.every((cond) => this.matchWhere(item, cond))) return false;
        continue;
      }

      if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
        const itemVal = item[key];
        const valObj = val as any;
        if (valObj.gte !== undefined) {
          const comp = this.toEpoch(itemVal);
          const target = this.toEpoch(valObj.gte);
          if (comp !== null && target !== null) {
            if (comp < target) return false;
          } else if (itemVal < valObj.gte) return false;
        }
        if (valObj.lte !== undefined) {
          const comp = this.toEpoch(itemVal);
          const target = this.toEpoch(valObj.lte);
          if (comp !== null && target !== null) {
            if (comp > target) return false;
          } else if (itemVal > valObj.lte) return false;
        }
        if (valObj.gt !== undefined) {
          const comp = this.toEpoch(itemVal);
          const target = this.toEpoch(valObj.gt);
          if (comp !== null && target !== null) {
            if (comp <= target) return false;
          } else if (itemVal <= valObj.gt) return false;
        }
        if (valObj.lt !== undefined) {
          const comp = this.toEpoch(itemVal);
          const target = this.toEpoch(valObj.lt);
          if (comp !== null && target !== null) {
            if (comp >= target) return false;
          } else if (itemVal >= valObj.lt) return false;
        }
        if (valObj.in !== undefined && Array.isArray(valObj.in)) {
          if (!valObj.in.includes(itemVal)) return false;
        }
        continue;
      }

      if (item[key] !== val) {
        return false;
      }
    }
    return true;
  }
}

export function createMockPrisma() {
  const mock: any = {
    camera: new MockCollection<any>(),
    user: new MockCollection<any>(),
    cameraPermission: new MockCollection<any>(),
    bookmark: new MockCollection<any>(),
    exportJob: new MockCollection<any>(),
    recording: new MockCollection<any>(),
    recordingSchedule: new MockCollection<any>(),
    motionZone: new MockCollection<any>(),
    webhookEndpoint: new MockCollection<any>(),
    notificationConfig: new MockCollection<any>(),
    event: new MockCollection<any>(),
    auditLog: new MockCollection<any>(),
    $disconnect: async () => {},
  };
  mock.$transaction = async (fn: any) => {
    if (typeof fn === 'function') {
      return await fn(mock);
    }
    return Promise.all(fn);
  };
  return mock;
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
