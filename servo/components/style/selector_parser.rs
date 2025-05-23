/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! The pseudo-classes and pseudo-elements supported by the style system.

#![deny(missing_docs)]

use crate::stylesheets::{Namespaces, Origin, UrlExtraData};
use crate::values::serialize_atom_identifier;
use crate::Atom;
use cssparser::{Parser as CssParser, ParserInput};
use dom::ElementState;
use selectors::parser::{ParseRelative, SelectorList};
use std::fmt::{self, Debug, Write};
use style_traits::{CssWriter, ParseError, ToCss};

/// A convenient alias for the type that represents an attribute value used for
/// selector parser implementation.
pub type AttrValue = <SelectorImpl as ::selectors::SelectorImpl>::AttrValue;

#[cfg(feature = "servo")]
pub use crate::servo::selector_parser::*;

#[cfg(feature = "gecko")]
pub use crate::gecko::selector_parser::*;

#[cfg(feature = "servo")]
pub use crate::servo::selector_parser::ServoElementSnapshot as Snapshot;

#[cfg(feature = "gecko")]
pub use crate::gecko::snapshot::GeckoElementSnapshot as Snapshot;

#[cfg(feature = "servo")]
pub use crate::servo::restyle_damage::ServoRestyleDamage as RestyleDamage;

#[cfg(feature = "gecko")]
pub use crate::gecko::restyle_damage::GeckoRestyleDamage as RestyleDamage;

/// Servo's selector parser.
#[cfg_attr(feature = "servo", derive(MallocSizeOf))]
pub struct SelectorParser<'a> {
    /// The origin of the stylesheet we're parsing.
    pub stylesheet_origin: Origin,
    /// The namespace set of the stylesheet.
    pub namespaces: &'a Namespaces,
    /// The extra URL data of the stylesheet, which is used to look up
    /// whether we are parsing a chrome:// URL style sheet.
    pub url_data: &'a UrlExtraData,
    /// Whether we're parsing selectors for `@supports`
    pub for_supports_rule: bool,
}

impl<'a> SelectorParser<'a> {
    /// Parse a selector list with an author origin and without taking into
    /// account namespaces.
    ///
    /// This is used for some DOM APIs like `querySelector`.
    pub fn parse_author_origin_no_namespace<'i>(
        input: &'i str,
        url_data: &UrlExtraData,
    ) -> Result<SelectorList<SelectorImpl>, ParseError<'i>> {
        let namespaces = Namespaces::default();
        let parser = SelectorParser {
            stylesheet_origin: Origin::Author,
            namespaces: &namespaces,
            url_data,
            for_supports_rule: false,
        };
        let mut input = ParserInput::new(input);
        SelectorList::parse(&parser, &mut CssParser::new(&mut input), ParseRelative::No)
    }

    /// Whether we're parsing selectors in a user-agent stylesheet.
    pub fn in_user_agent_stylesheet(&self) -> bool {
        matches!(self.stylesheet_origin, Origin::UserAgent)
    }

    /// Whether we're parsing selectors in a stylesheet that has chrome
    /// privilege.
    pub fn chrome_rules_enabled(&self) -> bool {
        self.url_data.chrome_rules_enabled() || self.stylesheet_origin == Origin::User
    }
}

/// This enumeration determines how a pseudo-element cascades.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PseudoElementCascadeType {
    /// Eagerly cascaded pseudo-elements are "normal" pseudo-elements (i.e.
    /// `::before` and `::after`). They inherit styles normally as another
    /// selector would do, and they're computed as part of the cascade.
    ///
    /// These kind of pseudo-elements require more up-front computation and
    /// storage and thus should used for public pseudo-elements that can be used
    /// on many element types (such as `::before` and `::after`).
    Eager,
    /// Lazy pseudo-elements are affected by selector matching, but they're only
    /// computed when needed, and not before. They're useful for general
    /// pseudo-elements that are not very common or that do not apply to many
    /// elements. For instance in Servo this is used for `::backdrop` and
    /// `::marker`.
    Lazy,
    /// Precomputed pseudo-elements skip the cascade process entirely, mostly as
    /// an optimisation since they are private pseudo-elements (like
    /// `::-servo-details-content`).
    ///
    /// This pseudo-elements are resolved on the fly using *only* global rules
    /// (rules of the form `*|*`), and applying them to the parent style so are
    /// mainly useful for user-agent stylesheets.
    Precomputed,
}

/// A per-pseudo map, from a given pseudo to a `T`.
#[derive(Clone, MallocSizeOf)]
pub struct PerPseudoElementMap<T> {
    entries: [Option<T>; PSEUDO_COUNT],
}

impl<T> Default for PerPseudoElementMap<T> {
    fn default() -> Self {
        Self {
            entries: PseudoElement::pseudo_none_array(),
        }
    }
}

impl<T> Debug for PerPseudoElementMap<T>
where
    T: Debug,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_char('[')?;
        let mut first = true;
        for entry in self.entries.iter() {
            if !first {
                f.write_str(", ")?;
            }
            first = false;
            entry.fmt(f)?;
        }
        f.write_char(']')
    }
}

impl<T> PerPseudoElementMap<T> {
    /// Get an entry in the map.
    pub fn get(&self, pseudo: &PseudoElement) -> Option<&T> {
        self.entries[pseudo.index()].as_ref()
    }

    /// Clear this enumerated array.
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    /// Set an entry value.
    ///
    /// Returns an error if the element is not a simple pseudo.
    pub fn set(&mut self, pseudo: &PseudoElement, value: T) {
        self.entries[pseudo.index()] = Some(value);
    }

    /// Get an entry for `pseudo`, or create it with calling `f`.
    pub fn get_or_insert_with<F>(&mut self, pseudo: &PseudoElement, f: F) -> &mut T
    where
        F: FnOnce() -> T,
    {
        let index = pseudo.index();
        if self.entries[index].is_none() {
            self.entries[index] = Some(f());
        }
        self.entries[index].as_mut().unwrap()
    }

    /// Get an iterator for the entries.
    pub fn iter(&self) -> std::slice::Iter<Option<T>> {
        self.entries.iter()
    }

    /// Get a mutable iterator for the entries.
    pub fn iter_mut(&mut self) -> std::slice::IterMut<Option<T>> {
        self.entries.iter_mut()
    }
}

/// Values for the :dir() pseudo class
///
/// "ltr" and "rtl" values are normalized to lowercase.
#[derive(Clone, Debug, Eq, MallocSizeOf, PartialEq, ToShmem)]
pub struct Direction(pub Atom);

/// Horizontal values for the :dir() pseudo class
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HorizontalDirection {
    /// :dir(ltr)
    Ltr,
    /// :dir(rtl)
    Rtl,
}

impl Direction {
    /// Parse a direction value.
    pub fn parse<'i, 't>(parser: &mut CssParser<'i, 't>) -> Result<Self, ParseError<'i>> {
        let ident = parser.expect_ident()?;
        Ok(Direction(match_ignore_ascii_case! { &ident,
            "rtl" => atom!("rtl"),
            "ltr" => atom!("ltr"),
            _ => Atom::from(ident.as_ref()),
        }))
    }

    /// Convert this Direction into a HorizontalDirection, if applicable
    pub fn as_horizontal_direction(&self) -> Option<HorizontalDirection> {
        if self.0 == atom!("ltr") {
            Some(HorizontalDirection::Ltr)
        } else if self.0 == atom!("rtl") {
            Some(HorizontalDirection::Rtl)
        } else {
            None
        }
    }

    /// Gets the element state relevant to this :dir() selector.
    pub fn element_state(&self) -> ElementState {
        match self.as_horizontal_direction() {
            Some(HorizontalDirection::Ltr) => ElementState::LTR,
            Some(HorizontalDirection::Rtl) => ElementState::RTL,
            None => ElementState::empty(),
        }
    }
}

impl ToCss for Direction {
    fn to_css<W>(&self, dest: &mut CssWriter<W>) -> fmt::Result
    where
        W: Write,
    {
        serialize_atom_identifier(&self.0, dest)
    }
}
