// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use std::sync::Arc;

use crate::common_metric_data::CommonMetricDataInternal;
use crate::error_recording::ErrorType;
use crate::metrics::MetricType;
use crate::metrics::Rate;
use crate::metrics::RateMetric;
use crate::CommonMetricData;
use crate::Glean;

/// Developer-facing API for recording rate metrics with external denominators.
///
/// Instances of this class type are automatically generated by the parsers
/// at build time, allowing developers to record values that were previously
/// registered in the metrics.yaml file.
#[derive(Clone)]
pub struct NumeratorMetric(pub(crate) Arc<RateMetric>);

impl MetricType for NumeratorMetric {
    fn meta(&self) -> &CommonMetricDataInternal {
        self.0.meta()
    }
}

impl NumeratorMetric {
    /// The public constructor used by automatically generated metrics.
    pub fn new(meta: CommonMetricData) -> Self {
        Self(Arc::new(RateMetric::new(meta)))
    }

    /// Increases the numerator by `amount`.
    ///
    /// # Arguments
    ///
    /// * `amount` - The amount to increase by. Should be non-negative.
    ///
    /// ## Notes
    ///
    /// Logs an error if the `amount` is negative.
    pub fn add_to_numerator(&self, amount: i32) {
        let metric = self.clone();
        crate::launch_with_glean(move |glean| metric.add_to_numerator_sync(glean, amount));
    }

    #[doc(hidden)]
    pub fn add_to_numerator_sync(&self, glean: &Glean, amount: i32) {
        self.0.add_to_numerator_sync(glean, amount)
    }

    /// **Exported for test purposes.**
    ///
    /// Gets the currently stored value as a pair of integers.
    ///
    /// This doesn't clear the stored value.
    ///
    /// # Arguments
    ///
    /// * `ping_name` - the optional name of the ping to retrieve the metric
    ///                 for. Defaults to the first value in `send_in_pings`.
    ///
    /// # Returns
    ///
    /// The stored value or `None` if nothing stored.
    pub fn test_get_value(&self, ping_name: Option<String>) -> Option<Rate> {
        crate::block_on_dispatcher();
        crate::core::with_glean(|glean| self.get_value(glean, ping_name.as_deref()))
    }

    #[doc(hidden)]
    pub fn get_value<'a, S: Into<Option<&'a str>>>(
        &self,
        glean: &Glean,
        ping_name: S,
    ) -> Option<Rate> {
        self.0.get_value(glean, ping_name)
    }

    /// **Exported for test purposes.**
    ///
    /// Gets the number of recorded errors for the given metric and error type.
    ///
    /// # Arguments
    ///
    /// * `error` - The type of error
    ///
    /// # Returns
    ///
    /// The number of errors reported.
    pub fn test_get_num_recorded_errors(&self, error: ErrorType) -> i32 {
        self.0.test_get_num_recorded_errors(error)
    }
}
