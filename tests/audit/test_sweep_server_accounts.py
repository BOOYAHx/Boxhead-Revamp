"""Reproductions for docs/audits/2026-10-16-server-accounts.md.

Attack cases fail while the defect is present; guard cases are the
legitimate path of the same flow and must always pass.
"""
import unittest

from sweep_fixture import ServerCase


class FailedLoginLimit(ServerCase):
    """F1: nothing limits repeated wrong passwords on one account."""

    def test_attack_many_wrong_passwords_then_the_right_one_is_still_accepted(self):
        self.register('Victim', 'abc123')
        for attempt in range(50):
            self.login('Victim', f'guess{attempt}')
        handler = self.login('Victim', 'abc123')
        self.assertNotIn('10;1;', handler.request.text(),
                         'after 50 wrong passwords in a row the account should be locked for a while')

    def test_guard_a_couple_of_typos_then_the_right_password_logs_in(self):
        self.register('Player', 'abc123')
        self.login('Player', 'abc124')
        self.login('Player', 'abd123')
        handler = self.login('Player', 'abc123')
        self.assertIn('10;1;', handler.request.text())


class PasswordStorage(ServerCase):
    """F2: passwords are stored as unsalted MD5."""

    def test_attack_the_stored_value_is_the_plain_md5_of_the_password(self):
        self.register('Hunter', 'abc123')
        stored = self.server.USER_DB['hunter']['password_hash']
        self.assertNotEqual(stored, self.server.md5_hash('abc123'),
                            'an unsalted MD5 is cracked from a leaked users.db in seconds')

    def test_guard_the_registered_password_logs_in(self):
        self.register('Hunter', 'abc123')
        self.assertIn('10;1;', self.login('Hunter', 'abc123').request.text())


class LoginErrorsRevealAccounts(ServerCase):
    """F3 (Low): unknown names and wrong passwords get different replies."""

    def test_attack_the_reply_tells_whether_a_name_exists(self):
        self.register('Hunter', 'abc123')
        unknown = self.login('Nobody', 'abc123').request.text()
        wrong = self.login('Hunter', 'zzz999').request.text()
        self.assertEqual(unknown, wrong)

    def test_guard_a_wrong_password_is_refused(self):
        self.register('Hunter', 'abc123')
        self.assertIn('10;0;', self.login('Hunter', 'zzz999').request.text())


class LoginReplySendsHash(ServerCase):
    """F4 (Low): the login reply carries the stored password hash."""

    def test_attack_the_password_hash_is_sent_to_the_client(self):
        self.register('Hunter', 'abc123')
        reply = self.login('Hunter', 'abc123').request.text()
        self.assertNotIn(self.server.USER_DB['hunter']['password_hash'], reply)

    def test_guard_the_login_reply_still_names_the_account(self):
        self.register('Hunter', 'abc123')
        reply = self.login('Hunter', 'abc123').request.text()
        self.assertIn('10;1;', reply)
        self.assertIn(';Hunter;Hunter;', reply)


if __name__ == '__main__':
    unittest.main()
