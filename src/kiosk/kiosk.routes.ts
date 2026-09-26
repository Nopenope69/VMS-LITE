import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { kioskService } from './kiosk.service.js';
import { PairStationDto } from './kiosk.types.js';

export const kioskRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // TV requests temporary pairing PIN
  app.post('/kiosk/pair-code', async () => {
    const pairData = kioskService.generatePairingCode();
    return { success: true, ...pairData };
  });

  // Admin enters PIN to link TV station
  app.post<{ Body: PairStationDto }>('/kiosk/pair', async (request, reply) => {
    if (!request.body?.pairingCode) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Pairing code is required' });
    }

    const station = kioskService.pairStation(request.body);
    if (!station) {
      return reply.status(400).send({
        error: 'InvalidCode',
        message: 'Invalid or expired 4-digit pairing code',
      });
    }

    return reply.status(201).send({ success: true, station });
  });

  // TV uses permanent token to authenticate without passwords
  app.get<{ Params: { stationKey: string } }>('/kiosk/station/:stationKey', async (request, reply) => {
    const station = kioskService.getStationByKey(request.params.stationKey);
    if (!station) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid station key' });
    }

    return { success: true, station };
  });

  // Periodic heartbeat from TV
  app.post<{ Params: { stationKey: string } }>('/kiosk/heartbeat/:stationKey', async (request, reply) => {
    const ok = kioskService.heartbeat(request.params.stationKey);
    if (!ok) {
      return reply.status(404).send({ error: 'NotFound', message: 'Station key not found' });
    }
    return { success: true, status: 'online' };
  });

  // Admin lists all wall displays
  app.get('/kiosk/stations', async () => {
    const stations = kioskService.listStations();
    return { success: true, stations };
  });

  // Admin changes what TV is displaying remotely
  app.put<{ Params: { id: string } }>('/kiosk/stations/:id', async (request, reply) => {
    const updated = kioskService.updateStation(request.params.id, request.body as any);
    if (!updated) {
      return reply.status(404).send({ error: 'NotFound', message: 'Station not found' });
    }
    return { success: true, station: updated };
  });

  // Admin unpairs TV
  app.delete<{ Params: { id: string } }>('/kiosk/stations/:id', async (request, reply) => {
    const ok = kioskService.deleteStation(request.params.id);
    if (!ok) {
      return reply.status(404).send({ error: 'NotFound', message: 'Station not found' });
    }
    return { success: true, message: 'Station deleted successfully' };
  });
};
