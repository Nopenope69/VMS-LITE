import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OnvifEventListenerService } from '../src/events/onvif-events.service.js';
import { EventBus } from '../src/events/event-bus.js';
import {
  ONVIF_TOPIC_CELL_MOTION,
  ONVIF_TOPIC_VIDEO_SOURCE_MOTION,
  ONVIF_TOPIC_TAMPER,
} from '../src/events/onvif-events.types.js';
import { CoreEventType } from '../src/events/event.types.js';

describe('OnvifEventListenerService (EVT-03, EVT-04)', () => {
  let eventBus: EventBus;
  let service: OnvifEventListenerService;

  beforeEach(() => {
    // Create new event bus without DB dependency for unit test isolation
    eventBus = new EventBus();
    service = new OnvifEventListenerService(eventBus, true); // mockMode = true
  });

  describe('SOAP XML Envelopes', () => {
    it('generates valid CreatePullPointSubscription SOAP envelope with WS-Security', () => {
      const envelope = service.buildCreatePullPointEnvelope(
        {
          cameraId: 'cam-1',
          cameraName: 'Entrance Camera',
          xaddr: 'http://192.168.1.100:80/onvif/device_service',
          username: 'admin',
          password: 'Password123!',
          subscriptionUrl: null,
          terminationTime: null,
          active: true,
          errorCount: 0,
          lastPoll: null,
        },
        'PT60S'
      );

      expect(envelope).toContain('<tev:CreatePullPointSubscription>');
      expect(envelope).toContain('<tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>');
      expect(envelope).toContain('<wsse:Username>admin</wsse:Username>');
      expect(envelope).toContain('PasswordDigest');
    });

    it('generates valid PullMessages SOAP envelope with timeout and limit', () => {
      const envelope = service.buildPullMessagesEnvelope(
        {
          cameraId: 'cam-1',
          cameraName: 'Entrance Camera',
          xaddr: 'http://192.168.1.100:80/onvif/device_service',
          subscriptionUrl: 'http://192.168.1.100:80/onvif/Subscription?Idx=0',
          terminationTime: null,
          active: true,
          errorCount: 0,
          lastPoll: null,
        },
        'PT5S',
        10
      );

      expect(envelope).toContain('<tev:PullMessages>');
      expect(envelope).toContain('<tev:Timeout>PT5S</tev:Timeout>');
      expect(envelope).toContain('<tev:MessageLimit>10</tev:MessageLimit>');
    });
  });

  describe('SOAP Notification Parsing (T-06-02)', () => {
    it('parses CellMotionDetector motion event with IsMotion=true', () => {
      const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"
               xmlns:tt="http://www.onvif.org/ver10/schema">
  <soap:Body>
    <wsnt:PullMessagesResponse>
      <wsnt:NotificationMessage>
        <wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">
          ${ONVIF_TOPIC_CELL_MOTION}
        </wsnt:Topic>
        <wsnt:Message UtcTime="2026-09-24T12:00:00Z">
          <tt:Message>
            <tt:Data>
              <tt:SimpleItem Name="IsMotion" Value="true" />
            </tt:Data>
          </tt:Message>
        </wsnt:Message>
      </wsnt:NotificationMessage>
    </wsnt:PullMessagesResponse>
  </soap:Body>
</soap:Envelope>`;

      const events = service.parseSoapNotification(sampleXml);
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe(ONVIF_TOPIC_CELL_MOTION);
      expect(events[0].isMotion).toBe(true);
      expect(events[0].data['IsMotion']).toBe('true');
    });

    it('parses VideoSource MotionAlarm event with State=true', () => {
      const sampleXml = `
      <wsnt:NotificationMessage>
        <wsnt:Topic>${ONVIF_TOPIC_VIDEO_SOURCE_MOTION}</wsnt:Topic>
        <wsnt:Message UtcTime="2026-09-24T12:05:00Z">
          <tt:Message>
            <tt:Data>
              <tt:SimpleItem Name="State" Value="true" />
            </tt:Data>
          </tt:Message>
        </wsnt:Message>
      </wsnt:NotificationMessage>`;

      const events = service.parseSoapNotification(sampleXml);
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe(ONVIF_TOPIC_VIDEO_SOURCE_MOTION);
      expect(events[0].isMotion).toBe(true);
    });

    it('parses Tamper event with State=true', () => {
      const sampleXml = `
      <wsnt:NotificationMessage>
        <wsnt:Topic>${ONVIF_TOPIC_TAMPER}</wsnt:Topic>
        <wsnt:Message UtcTime="2026-09-24T12:10:00Z">
          <tt:Message>
            <tt:Data>
              <tt:SimpleItem Name="State" Value="true" />
            </tt:Data>
          </tt:Message>
        </wsnt:Message>
      </wsnt:NotificationMessage>`;

      const events = service.parseSoapNotification(sampleXml);
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe(ONVIF_TOPIC_TAMPER);
      expect(events[0].isTamper).toBe(true);
    });

    it('ignores motion messages where IsMotion=false (idle / end of motion)', () => {
      const sampleXml = `
      <wsnt:NotificationMessage>
        <wsnt:Topic>${ONVIF_TOPIC_CELL_MOTION}</wsnt:Topic>
        <wsnt:Message UtcTime="2026-09-24T12:15:00Z">
          <tt:Message>
            <tt:Data>
              <tt:SimpleItem Name="IsMotion" Value="false" />
            </tt:Data>
          </tt:Message>
        </wsnt:Message>
      </wsnt:NotificationMessage>`;

      const events = service.parseSoapNotification(sampleXml);
      expect(events).toHaveLength(1);
      expect(events[0].isMotion).toBe(false);
    });
  });

  describe('Subscription Management & Event Bus Emission (EVT-03, EVT-04)', () => {
    it('manages camera subscription lifecycle (subscribe and unsubscribe)', async () => {
      const sub = await service.subscribeCamera({
        id: 'cam-test-1',
        name: 'Warehouse North',
        ip: '192.168.1.120',
        port: 80,
      });

      expect(sub.active).toBe(true);
      expect(service.getSubscriptions()).toHaveLength(1);
      expect(service.getSubscription('cam-test-1')).toBeDefined();

      service.unsubscribeCamera('cam-test-1');
      expect(service.getSubscriptions()).toHaveLength(0);
      expect(service.getSubscription('cam-test-1')).toBeUndefined();
    });

    it('emits motion.detected event to eventBus when motion is detected', async () => {
      await service.subscribeCamera({
        id: 'cam-front',
        name: 'Front Gate',
        ip: '192.168.1.50',
      });

      let emittedEvent: any = null;
      eventBus.subscribe(CoreEventType.MOTION_DETECTED, (evt) => {
        emittedEvent = evt;
      });

      await service.triggerMockMotion('cam-front');

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.type).toBe(CoreEventType.MOTION_DETECTED);
      expect(emittedEvent.cameraId).toBe('cam-front');
      expect(emittedEvent.source).toBe('onvif.motion');
      expect(emittedEvent.severity).toBe('warning');
      expect(emittedEvent.metadata.cameraName).toBe('Front Gate');
    });
  });
});
