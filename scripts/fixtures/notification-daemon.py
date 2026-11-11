"""Test-only desktop notification endpoint. Run on an isolated session bus."""

import json

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)


class Notifications(dbus.service.Object):
    def __init__(self):
        self.bus = dbus.SessionBus()
        self.name = dbus.service.BusName(
            'org.freedesktop.Notifications', self.bus, do_not_queue=True
        )
        super().__init__(self.bus, '/org/freedesktop/Notifications')
        self.next_id = 0

    @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='as')
    def GetCapabilities(self):
        return ['body', 'actions']

    @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='ssss')
    def GetServerInformation(self):
        return ('Dovo fixture', 'Dovo', '1', '1.2')

    @dbus.service.method(
        'org.freedesktop.Notifications', in_signature='susssasa{sv}i', out_signature='u'
    )
    def Notify(self, app, replaces, icon, title, body, actions, hints, timeout):
        self.next_id += 1
        print(json.dumps({
            'type': 'notify', 'id': self.next_id, 'title': str(title),
            'body': str(body), 'actions': list(actions),
        }), flush=True)
        return self.next_id

    @dbus.service.method('org.freedesktop.Notifications', in_signature='u', out_signature='')
    def CloseNotification(self, notification_id):
        print(json.dumps({'type': 'close', 'id': int(notification_id)}), flush=True)
        self.NotificationClosed(notification_id, 3)

    @dbus.service.signal('org.freedesktop.Notifications', signature='uu')
    def NotificationClosed(self, notification_id, reason):
        pass

    @dbus.service.signal('org.freedesktop.Notifications', signature='us')
    def ActionInvoked(self, notification_id, action):
        pass

    @dbus.service.method('org.dovo.NotificationFixture', in_signature='u', out_signature='')
    def Activate(self, notification_id):
        self.ActionInvoked(notification_id, 'default')


notifications = Notifications()
print('READY', flush=True)
GLib.MainLoop().run()
