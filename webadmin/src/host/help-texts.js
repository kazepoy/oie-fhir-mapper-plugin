// SPDX-License-Identifier: MPL-2.0
// The contextual help of the editors: one entry per tab or panel.

export const MAPPER_HELP = {
  properties: {
    label: "help.help_properties",
    sections: [
      { title: "help.what_this_step_does", lines: [
        "help.a_fhir_mapper_transform_step_builds",
        ["common.create_a_bundle", "help.declares_a_bundle_by_name_and"],
        ["common.build_a_resource", "help.maps_the_message_onto_a_profile"]] },
      { title: "help.where_the_profile_comes_from", lines: [
        ["common.fhir_context", "help.a_named_set_of_packages_terminology"],
        ["help.profile_packages", "help.without_a_context_server_paths_of"],
        ["common.target_profile", "help.canonical_url_of_the_profile_or"]] },
      { title: "common.result", lines: [
        ["common.result_destination", "help.the_outbound_message_or_a_channel"],
        ["common.reference_name", "help.the_name_other_steps_give_to"],
        ["help.validate_fhir_output", "help.always_off_or_as_the_context"],
        ["help.trace_processed_messages", "help.keeps_this_step_s_events_on"]] },
      { title: "common.edit_as_json", lines: ["help.the_whole_step_as_text_to"] }
    ]
  },
  mapper: {
    label: "help.help_mapper",
    sections: [
      { title: "help.reading_the_tree", lines: [
        "help.one_row_per_element_of_the",
        ["1..*", "help.minimum_and_maximum_a_red_count"],
        ["common.s", "help.must_support_in_the_profile"],
        ["help.fixed_pattern", "help.a_value_the_profile_imposes_it"],
        ["help.binding", "help.the_element_takes_its_codes_from"],
        ["help.red_row", "help.the_last_test_or_the_compilation"]] },
      { title: "help.writing_a_mapping", lines: [
        "help.click_a_field_to_edit_it",
        ["⌥Space / Ctrl+Space", "Suggestions: functions, scoped variables and sample paths. ↑/↓ to choose, Enter/Tab to insert, Esc to close. Guard optional values."],
        ["help.alt_to", "help.next_or_previous_field_open_or"]] },
      { title: "common.element_inspector", lines: [
        "help.select_an_element_by_its_name",
        "help.read_the_profile_s_definition_cardinality",
        "help.diagnostics_belong_to_the_selected_element"] },
      { title: "help.buttons_of_a_row", lines: [
        ["+ / −", "help.add_or_remove_an_entry_of"],
        ["↻", "help.one_entry_per_item_of_a"],
        ["⇄", "help.translate_the_value_with_a_conceptmap"],
        ["?", "help.only_map_this_element_and_what"]] },
      { title: "help.branch_actions_and_extensions", lines: [
        "help.right_click_a_row_press_shift",
        "help.duplicate_branch_copies_a_mapped_repeating",
        "help.in_the_inspector_profile_extension_reveals",
        "help.conceptmaps_are_suggested_by_source_target"] },
      { title: "help.toolbar", lines: [
        ["common.show", "help.all_elements_must_support_and_required"],
        ["help.search", "help.filters_the_tree_and_opens_the"],
        ["help.undo_redo", "help.of_the_mappings_while_the_step"],
        ["help.full_screen", "help.the_step_on_the_whole_page"]] }
    ],
    note: "help.a_missing_optional_field_must_give"
  },
  test: {
    label: "help.help_test",
    sections: [
      { title: "help.what_a_test_runs", lines: [
        "help.preview_scope_chooses_this_step_alone",
        "help.testing_runs_the_step_s_code"] },
      { title: "help.samples", lines: [
        ["common.save_as_sample", "help.keeps_the_message_in_the_step"],
        ["common.use_this_result_as_expected", "help.fixes_the_reference_result_of_the"],
        ["help.run_all", "help.runs_every_saved_sample_passed_or"],
        "help.random_identities_urn_uuid_and_meta"] },
      { title: "help.understanding_a_result", lines: [
        ["common.go_to_rule", "help.opens_the_element_an_error_or"],
        ["common.trace", "help.records_each_rule_value_conversion_translation"],
        ["common.generated_script", "help.the_javascript_the_server_compiles_from"]] }
    ]
  }
};

export const FML_HELP = {
  settings: {
    label: "help.help_properties",
    sections: [
      { title: "help.what_this_step_does", lines: [
        "help.a_fhir_fml_transform_step_runs",
        "help.the_message_is_given_to_the"] },
      { title: "help.which_map_runs", lines: [
        ["help.map_tab", "help.a_map_written_in_the_step"],
        ["common.map", "help.otherwise_a_structuremap_of_the_locations"],
        ["common.fhir_context", "help.a_named_set_of_locations_defined"]] },
      { title: "common.result", lines: [
        ["common.result_destination", "help.outbound_or_channel_variable_short"],
        ["common.context_variables", "help.variables_of_the_oie_maps_copied"],
        ["common.validation", "help.against_the_profiles_of_meta_profile"]] }
    ]
  },
  map: {
    label: "help.help_map",
    sections: [
      { title: "help.writing_the_map", lines: [
        "help.a_map_written_here_is_saved",
        "help.map_url_name_then_uses_as",
        ["help.src_node_as_pid_where_name", "help.finds_a_node_of_the_message"],
        ["help.patient_gender_translate_v_url_code", "help.translates_with_a_conceptmap_of_the"],
        ["help.imports_url", "help.uses_the_groups_of_another_map"]] },
      { title: "help.buttons", lines: [
        ["common.check", "help.parses_the_map_on_the_server"],
        ["common.start_from_an_example", "help.a_small_map_to_adapt"],
        ["common.clear", "help.empties_the_map_the_step_then"]] }
    ],
    note: "help.the_test_tab_shows_the_model"
  },
  test: {
    label: "help.help_test",
    sections: [
      { title: "help.what_a_test_runs", lines: [
        "help.run_test_executes_the_map_on",
        ["common.result", "help.the_resource_the_map_built"],
        ["help.oie_model_of_the_message", "help.what_the_map_received_as_its"],
        "help.testing_needs_the_permission_test_fhir"] }
    ]
  }
};

export const SETTINGS_HELP = {
  label: "help.help_fhir_contexts",
  sections: [
    { title: "help.what_a_context_is", lines: [
      "help.a_named_set_of_profile_packages",
      "help.a_step_without_a_context_keeps"] },
    { title: "help.fields", lines: [
      ["common.packages", "help.one_server_path_per_line_files"],
      ["common.terminology_server", "help.base_url_as_oie_reaches_it"],
      ["common.validation", "help.for_the_steps_whose_validation_is"]] },
    { title: "help.when_a_change_applies", lines: [
      "help.the_editors_use_it_at_once",
      "help.saving_needs_the_permission_manage_fhir"] }
  ]
};
