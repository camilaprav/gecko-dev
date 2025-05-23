/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.awesomebar.facts

import mozilla.components.support.base.Component
import mozilla.components.support.base.facts.Action
import mozilla.components.support.base.facts.processor.CollectionProcessor
import org.junit.Assert.assertEquals
import org.junit.Test

class AwesomeBarFactsTest {

    @Test
    fun `Emits facts for current state`() {
        CollectionProcessor.withFactCollection { facts ->

            emitBookmarkSuggestionClickedFact()

            assertEquals(1, facts.size)
            facts[0].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.BOOKMARK_SUGGESTION_CLICKED, item)
            }

            emitClipboardSuggestionClickedFact()

            assertEquals(2, facts.size)
            facts[1].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.CLIPBOARD_SUGGESTION_CLICKED, item)
            }

            emitHistorySuggestionClickedFact()

            assertEquals(3, facts.size)
            facts[2].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.HISTORY_SUGGESTION_CLICKED, item)
            }

            emitSearchActionClickedFact()
            assertEquals(4, facts.size)
            facts[3].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.SEARCH_ACTION_CLICKED, item)
            }

            emitSearchSuggestionClickedFact()
            assertEquals(5, facts.size)
            facts[4].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.SEARCH_SUGGESTION_CLICKED, item)
            }

            emitTrendingSearchSuggestionClickedFact(3)
            assertEquals(6, facts.size)
            facts[5].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.TRENDING_SEARCH_SUGGESTION_CLICKED, item)
                assertEquals("3", value)
            }

            emitTopSiteSuggestionClickedFact(2)
            assertEquals(7, facts.size)
            facts[6].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.TOP_SITE_SUGGESTION_CLICKED, item)
                assertEquals("2", value)
            }

            emitOpenTabSuggestionClickedFact()
            assertEquals(8, facts.size)
            facts[7].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.OPENED_TAB_SUGGESTION_CLICKED, item)
            }

            emitSearchTermSuggestionClickedFact()
            assertEquals(9, facts.size)
            facts[8].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.SEARCH_TERM_SUGGESTION_CLICKED, item)
            }

            emitRecentSearchSuggestionClickedFact(1)
            assertEquals(10, facts.size)
            facts[9].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.RECENT_SEARCH_SUGGESTION_CLICKED, item)
                assertEquals("1", value)
            }

            emitTrendingSearchSuggestionsDisplayedFact(6)
            assertEquals(11, facts.size)
            facts[10].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.TRENDING_SEARCH_SUGGESTIONS_DISPLAYED, item)
                assertEquals("6", value)
            }

            emitTopSiteSuggestionsDisplayedFact(5)
            assertEquals(12, facts.size)
            facts[11].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.TOP_SITE_SUGGESTIONS_DISPLAYED, item)
                assertEquals("5", value)
            }

            emitRecentSearchSuggestionsDisplayedFact(4)
            assertEquals(13, facts.size)
            facts[12].apply {
                assertEquals(Component.FEATURE_AWESOMEBAR, component)
                assertEquals(Action.INTERACTION, action)
                assertEquals(AwesomeBarFacts.Items.RECENT_SEARCH_SUGGESTIONS_DISPLAYED, item)
                assertEquals("4", value)
            }
        }
    }
}
