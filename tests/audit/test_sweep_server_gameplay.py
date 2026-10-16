"""Reproductions for docs/audits/2026-10-16-server-gameplay.md.

A cheater here is a logged-in player who sends raw packets of their choice.
Attack cases fail while the defect is present; guard cases are the
legitimate path of the same flow and must always pass.
"""
import unittest

from sweep_fixture import ServerCase


class UnknownPacketRelay(ServerCase):
    """F1: an unknown packet is relayed to the room unchanged, without the sender's id."""

    def test_attack_a_player_sends_a_fake_server_disconnect_to_another(self):
        self.ffa_room()
        self.send('201', 'D' + self.wire('202'))
        self.assertNotIn('D' + self.wire('202'), self.sockets['202'].text(),
                         "bob's client would end his session on this fake server packet")

    def test_attack_a_player_sends_a_death_in_another_players_name(self):
        self.ffa_room()
        forged = 'M' + self.wire('202') + '7' + self.wire('201') + '00'
        self.send('201', forged)
        self.assertNotIn(forged, self.sockets['203'].text())

    def test_guard_movement_is_relayed_with_the_senders_id(self):
        self.ffa_room()
        self.send('201', '10050000500000')
        self.assertIn('M' + self.wire('201') + '1', self.sockets['202'].text())


class BadPositionBreaksDeaths(ServerCase):
    """F2: one malformed position stops every death in the room from dropping crates or being announced."""

    def lethal_hit_on_cat(self):
        try:
            self.send('203', '6' + self.wire('201') + '00' + '100')
        except ValueError as error:
            return error
        return None

    def test_attack_a_position_with_underscores_breaks_another_players_death(self):
        room = self.ffa_room()
        self.send('202', '112_3412_34000')  # bob's raw movement packet
        error = self.lethal_hit_on_cat()
        self.assertIsNone(error, f'the death handler raised {error!r}')
        self.assertIn('M' + self.wire('203') + '7', self.sockets['201'].text())
        self.assertTrue(room['crates'], 'the bounty crates were never dropped')

    def test_guard_a_normal_death_is_announced_and_drops_crates(self):
        room = self.ffa_room()
        self.send('202', '10120001200000')
        self.assertIsNone(self.lethal_hit_on_cat())
        self.assertIn('M' + self.wire('203') + '7', self.sockets['201'].text())
        self.assertTrue(room['crates'])


class SelfKillCredit(ServerCase):
    """F3: reporting yourself as your own killer counts a kill."""

    def test_attack_killing_yourself_scores_a_kill(self):
        self.ffa_room()
        self.send('201', '6' + self.wire('201') + '00' + '100')
        stats = self.server.USERS['201']['stats']
        self.assertEqual(stats['deaths'], 1)
        self.assertEqual(stats['kills'], 0, 'a suicide must not count as a kill')

    def test_guard_being_killed_by_another_player_credits_them(self):
        self.ffa_room()
        self.send('202', '6' + self.wire('201') + '00' + '100')
        self.assertEqual(self.server.USERS['201']['stats']['kills'], 1)
        self.assertEqual(self.server.USERS['202']['stats']['deaths'], 1)


class CratePickupRules(ServerCase):
    """F4: crates can be taken while dead, so a player can farm their own death's crates."""

    def test_attack_a_dead_player_picks_up_a_crate(self):
        room = self.ffa_room()
        self.send('203', '6' + self.wire('202') + '00' + '100')  # cat dies
        index = sorted(room['crates'])[0]
        score = self.server.USERS['203']['stats']['score']
        self.send('203', '0m' + index)  # cat, still dead, takes it
        self.assertIn(index, room['crates'], 'a dead player must not pick up crates')
        self.assertEqual(self.server.USERS['203']['stats']['score'], score)

    def test_guard_a_living_player_picks_up_a_crate(self):
        room = self.ffa_room()
        self.send('203', '6' + self.wire('202') + '00' + '100')
        index = sorted(room['crates'])[0]
        score = self.server.USERS['202']['stats']['score']
        self.send('202', '0m' + index)
        self.assertNotIn(index, room['crates'])
        self.assertGreater(self.server.USERS['202']['stats']['score'], score)


class DeployableDamage(ServerCase):
    """F5: anyone can destroy another player's barrel or barricade with one packet."""

    def place_barrel(self, account, position='0050000500'):
        self.send(account, '0q07')
        self.send(account, '1' + position + '000')
        self.send(account, '4000')

    def test_attack_another_player_destroys_a_barrel_from_anywhere(self):
        room = self.ffa_room()
        self.place_barrel('201')
        self.assertIn('00', room['deployables'], 'fixture: the barrel was not placed')
        self.send('202', 'o00' + self.wire('202') + '99')
        self.assertIn('00', room['deployables'], "only the owner's client reports damage to its deployables")

    def test_guard_the_owner_reports_its_barrel_destroyed(self):
        room = self.ffa_room()
        self.place_barrel('201')
        self.send('201', 'o00' + self.wire('201') + '99')
        self.assertNotIn('00', room['deployables'])


class DeployableSlots(ServerCase):
    """F6: one player can take all 100 deployable slots of a room."""

    def test_attack_one_player_fills_the_room_and_nobody_else_can_place(self):
        room = self.ffa_room()
        self.send('201', '0q08')
        for i in range(100):
            self.send('201', f'1{(i % 10) * 100 + 50:05d}{(i // 10) * 100 + 50:05d}000')
            self.send('201', '4000')
        self.assertEqual(len(room['deployables']), 100, 'fixture: placements failed')
        self.send('202', '0q08')
        self.send('202', '1' + '0505005050' + '000')
        self.send('202', '4000')
        owners = [d[1:4] for d in room['deployables'].values()]
        self.assertIn(self.wire('202'), owners, "bob's barricade was refused: the room is full of ann's")

    def test_guard_a_player_places_a_barricade(self):
        room = self.ffa_room()
        self.send('202', '0q08')
        self.send('202', '1' + '0505005050' + '000')
        self.send('202', '4000')
        self.assertIn(self.wire('202'), [d[1:4] for d in room['deployables'].values()])


class KillerLookupRace(ServerCase):
    """F7 (Low): the killer lookup iterates the shared USERS dict without a lock."""

    def lethal_hit_on_cat_by_bob(self):
        try:
            self.send('203', '6' + self.wire('202') + '00' + '100')
        except RuntimeError as error:
            return error
        return None

    def test_attack_a_login_during_the_killer_lookup_loses_the_death(self):
        self.ffa_room()
        s = self.server

        class LoginDuringIteration(dict):
            """Another thread adds a session while this one walks the table."""

            def items(self):
                for i, item in enumerate(dict.items(self)):
                    if i == 0 and 'late' not in self:
                        dict.__setitem__(self, 'late', {'room': '_', 'slot': 99})
                    yield item

        s.USERS = LoginDuringIteration(s.USERS)
        error = self.lethal_hit_on_cat_by_bob()
        self.assertIsNone(error, f'the death handler raised {error!r}')
        self.assertEqual(s.USERS['202']['stats']['kills'], 1)
        self.assertIn('M' + self.wire('203') + '7', self.sockets['201'].text())

    def test_guard_the_killer_is_credited_without_concurrent_logins(self):
        self.ffa_room()
        self.assertIsNone(self.lethal_hit_on_cat_by_bob())
        self.assertEqual(self.server.USERS['202']['stats']['kills'], 1)


if __name__ == '__main__':
    unittest.main()
