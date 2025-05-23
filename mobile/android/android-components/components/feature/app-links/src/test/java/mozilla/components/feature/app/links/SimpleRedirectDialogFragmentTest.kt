/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.app.links

import android.os.Looper.getMainLooper
import android.widget.Button
import android.widget.CheckBox
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.FragmentTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import mozilla.components.feature.app.links.SimpleRedirectDialogFragment.Companion.VIEW_ID
import mozilla.components.support.ktx.util.PromptAbuserDetector
import mozilla.components.support.test.mock
import mozilla.components.support.test.robolectric.testContext
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.doNothing
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.spy
import org.robolectric.Shadows.shadowOf
import androidx.appcompat.R as appcompatR

@RunWith(AndroidJUnit4::class)
class SimpleRedirectDialogFragmentTest {
    private val themeResId = appcompatR.style.Theme_AppCompat_Light

    @Before
    fun setUp() {
        PromptAbuserDetector.validationsEnabled = false
    }

    @After
    fun tearDown() {
        PromptAbuserDetector.validationsEnabled = true
    }

    @Test
    fun `GIVEN the checkbox is visible and ticked WHEN clicking on positive button THEN the callback is called correctly`() {
        var onConfirmAlwaysUncheckCalled = false
        var onConfirmedAlwaysCheckedCalled = false
        var onCancelCalled = false

        val onCancel = { onCancelCalled = true }

        val onConfirm: (Boolean?) -> Unit = { alwaysChecked ->
            if (alwaysChecked == true) {
                onConfirmedAlwaysCheckedCalled = true
            } else {
                onConfirmAlwaysUncheckCalled = true
            }
        }

        val fragment = spy(
            SimpleRedirectDialogFragment.newInstance(
                dialogTitleString = "Open in another app",
                themeResId = themeResId,
                showCheckbox = true,
            ),
        )
        doNothing().`when`(fragment).dismiss()

        doReturn(testContext).`when`(fragment).requireContext()

        val dialog = fragment.onCreateDialog(null)
        dialog.show()

        shadowOf(getMainLooper()).idle()

        val confirmButton = dialog.findViewById<Button>(android.R.id.button1)
        val checkbox = dialog.findViewById<CheckBox>(VIEW_ID)
        checkbox.isChecked = true

        fragment.onConfirmRedirect = {
            onConfirm(checkbox.isChecked)
        }

        fragment.onCancelRedirect = onCancel

        confirmButton?.performClick()

        assertTrue(onConfirmedAlwaysCheckedCalled)
        assertFalse(onConfirmAlwaysUncheckCalled)
        assertFalse(onCancelCalled)
    }

    @Test
    fun `Dialog cancel callback is called correctly`() {
        var onConfirmCalled = false
        var onCancelCalled = false

        val onConfirm = { onConfirmCalled = true }
        val onCancel = { onCancelCalled = true }

        val fragment = spy(
            SimpleRedirectDialogFragment.newInstance(
                dialogTitleString = "Open in another app",
                themeResId = themeResId,
            ),
        )
        doNothing().`when`(fragment).dismiss()

        doReturn(testContext).`when`(fragment).requireContext()

        fragment.onConfirmRedirect = { onConfirm() }
        fragment.onCancelRedirect = onCancel

        val dialog = fragment.onCreateDialog(null)
        dialog.show()

        val confirmButton = dialog.findViewById<Button>(android.R.id.button2)
        confirmButton?.performClick()
        shadowOf(getMainLooper()).idle()

        assertFalse(onConfirmCalled)
        assertTrue(onCancelCalled)
    }

    @Test
    fun `Dialog confirm and cancel is not called when dismissed`() {
        var onConfirmCalled = false
        var onCancelCalled = false

        val onConfirm = { onConfirmCalled = true }
        val onCancel = { onCancelCalled = true }

        val fragment = spy(
            SimpleRedirectDialogFragment.newInstance(
                dialogTitleString = "Open in another app",
                themeResId = themeResId,
            ),
        )
        doNothing().`when`(fragment).dismiss()

        doReturn(testContext).`when`(fragment).requireContext()

        fragment.onConfirmRedirect = { onConfirm() }
        fragment.onCancelRedirect = onCancel

        val dialog = fragment.onCreateDialog(null)
        dialog.show()
        dialog.dismiss()

        assertFalse(onConfirmCalled)
        assertFalse(onCancelCalled)
    }

    @Suppress("unused")
    private fun mockFragmentManager(): FragmentManager {
        val fragmentManager: FragmentManager = mock()
        val transaction: FragmentTransaction = mock()
        doReturn(transaction).`when`(fragmentManager).beginTransaction()
        return fragmentManager
    }
}
